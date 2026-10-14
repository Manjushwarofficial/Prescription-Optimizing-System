"""
drug_mapper.py
==============
Output Pharmacological Harmonization Module (Phase 2 upgrade).

Translates raw hospital National Drug Codes (NDCs) into RxNorm Concept Unique
Identifiers (RxCUIs) and maps those onto the Anatomical Therapeutic Chemical
(ATC) classification hierarchy at ATC-3 and ATC-4 levels.

This resolves branded pharmaceutical products into their standard active
chemical ingredients, allowing downstream neural models to generalize therapeutic
mechanisms across similar compounds and reduce output space sparsity.

Mapping pipeline:
    NDC (11-digit)  ->  RxCUI  ->  ATC-4 code  ->  ATC-3 code (first 4 chars)

Data sources (in priority order):
    1. SafeDrug pre-computed mapping files (no API key required):
       - rxnorm2RXCUI.txt    : NDC -> RXCUI
       - RXCUI2atc4.csv      : RXCUI -> ATC4
       Reference: https://github.com/ycq091044/SafeDrug/tree/main/data
    2. NIH NLM RxNav REST API (no API key required):
       - NDC -> RxCUI : GET https://rxnav.nlm.nih.gov/REST/rxcui.json?idtype=NDC&id={ndc}
       - RxCUI -> ATC : GET https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json
                            ?rxcui={rxcui}&relaSource=ATC
       Reference: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html
    3. Curated formulary fallback (covers our 8 formulary drugs exactly)
"""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Curated formulary fallback mapping (always available, no files needed)
# Covers the 8-drug formulary defined in dataset_builder.py exactly.
# Format: NDC (11-digit) -> (RxCUI, drug_name, ATC4, ATC3)
# ---------------------------------------------------------------------------
_FORMULARY_NDC_MAP: Dict[str, Tuple[str, str, str, str]] = {
    # NDC            RxCUI     Name             ATC4    ATC3
    "00071015523": ("29046",  "Lisinopril",    "C09AA03", "C09A"),
    "00025134001": ("9997",   "Spironolactone","C03DA01", "C03D"),
    "00573018116": ("5640",   "Ibuprofen",     "M01AE01", "M01A"),
    "00603388821": ("7646",   "Omeprazole",    "A02BC01", "A02B"),
    "00093107001": ("6809",   "Metformin",     "A10BA02", "A10B"),
    "00071015401": ("83367",  "Atorvastatin",  "C10AA05", "C10A"),
    "00069153041": ("17767",  "Amlodipine",    "C08CA01", "C08C"),
    "00093226201": ("723",    "Amoxicillin",   "J01CA04", "J01C"),
}

# RxCUI -> (drug_name, ATC4, ATC3) for quick reverse lookup
_FORMULARY_RXCUI_MAP: Dict[str, Tuple[str, str, str]] = {
    rxcui: (name, atc4, atc3)
    for ndc, (rxcui, name, atc4, atc3) in _FORMULARY_NDC_MAP.items()
}

# Drug name -> (RxCUI, ATC4, ATC3) for name-based lookups
_FORMULARY_NAME_MAP: Dict[str, Tuple[str, str, str]] = {
    name.lower(): (rxcui, atc4, atc3)
    for ndc, (rxcui, name, atc4, atc3) in _FORMULARY_NDC_MAP.items()
}


class DrugHarmonizationResult:
    """Result of a successful NDC -> RxCUI -> ATC mapping."""

    __slots__ = ("ndc", "rxcui", "drug_name", "atc4", "atc3", "source")

    def __init__(
        self,
        ndc: str,
        rxcui: str,
        drug_name: str,
        atc4: str,
        atc3: str,
        source: str,
    ):
        self.ndc = ndc
        self.rxcui = rxcui
        self.drug_name = drug_name
        self.atc4 = atc4
        self.atc3 = atc3
        self.source = source  # 'curated' | 'safedrug_files' | 'rxnav_api'

    def to_dict(self) -> Dict:
        return {
            "ndc": self.ndc,
            "rxcui": self.rxcui,
            "drug_name": self.drug_name,
            "atc4": self.atc4,
            "atc3": self.atc3,
            "source": self.source,
        }

    def __repr__(self) -> str:
        return (
            f"DrugHarmonizationResult(ndc={self.ndc}, rxcui={self.rxcui}, "
            f"name={self.drug_name}, atc4={self.atc4}, source={self.source})"
        )


class DrugOntologyMapper:
    """
    Medication mapping pipeline: NDC -> RxCUI -> ATC-3/ATC-4.

    Supports three data sources (checked in priority order):
        1. Curated formulary fallback (always available)
        2. SafeDrug pre-computed files (rxnorm2RXCUI.txt, RXCUI2atc4.csv)
        3. NIH NLM RxNav REST API (live, no key required)

    Usage (curated fallback only):
        >>> mapper = DrugOntologyMapper()
        >>> result = mapper.map_ndc("00071015523")
        >>> result.drug_name, result.atc4
        ('Lisinopril', 'C09AA03')

    Usage (with SafeDrug files):
        >>> mapper = DrugOntologyMapper(
        ...     rxnorm2rxcui_path="data/rxnorm2RXCUI.txt",
        ...     rxcui2atc4_path="data/RXCUI2atc4.csv",
        ... )

    Usage (with live RxNav API fallback):
        >>> mapper = DrugOntologyMapper(use_rxnav_api=True)
    """

    _RXNAV_NDC_URL = "https://rxnav.nlm.nih.gov/REST/rxcui.json?idtype=NDC&id={ndc}"
    _RXNAV_ATC_URL = (
        "https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json"
        "?rxcui={rxcui}&relaSource=ATC"
    )

    def __init__(
        self,
        rxnorm2rxcui_path: Optional[str] = None,
        rxcui2atc4_path: Optional[str] = None,
        use_rxnav_api: bool = False,
        api_rate_limit_secs: float = 0.2,
    ):
        """
        Parameters
        ----------
        rxnorm2rxcui_path    : Path to SafeDrug's rxnorm2RXCUI.txt
                               (NDC -> RXCUI, tab-separated: NDC  RXCUI)
        rxcui2atc4_path      : Path to SafeDrug's RXCUI2atc4.csv
                               (columns: YEAR, MONTH, NDC, RXCUI, ATC4)
        use_rxnav_api        : If True, fall back to NIH NLM RxNav REST API
                               for NDCs not found in local files.
        api_rate_limit_secs  : Seconds to wait between API calls to respect
                               NLM rate limits (default: 0.2s = 5 req/s).
        """
        # NDC -> RxCUI mapping (loaded from SafeDrug file)
        self._ndc2rxcui: Dict[str, str] = {}
        # RxCUI -> ATC4 mapping (loaded from SafeDrug file)
        self._rxcui2atc4: Dict[str, str] = {}

        self.use_rxnav_api = use_rxnav_api
        self._api_rate_limit = api_rate_limit_secs

        if rxnorm2rxcui_path:
            self._load_rxnorm2rxcui(Path(rxnorm2rxcui_path))
        if rxcui2atc4_path:
            self._load_rxcui2atc4(Path(rxcui2atc4_path))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def map_ndc(self, ndc: str) -> Optional[DrugHarmonizationResult]:
        """
        Map an 11-digit NDC code to its RxCUI and ATC classification.

        Priority order: curated formulary -> SafeDrug files -> RxNav API.

        Parameters
        ----------
        ndc : str — 11-digit National Drug Code (zero-padded if shorter)

        Returns None if the NDC cannot be resolved through any available source.
        """
        ndc = self._normalise_ndc(ndc)

        # 1. Curated formulary (instant, no I/O)
        if ndc in _FORMULARY_NDC_MAP:
            rxcui, name, atc4, atc3 = _FORMULARY_NDC_MAP[ndc]
            return DrugHarmonizationResult(ndc, rxcui, name, atc4, atc3, "curated")

        # 2. SafeDrug pre-computed files
        result = self._lookup_from_files(ndc)
        if result:
            return result

        # 3. NIH RxNav REST API
        if self.use_rxnav_api:
            return self._lookup_from_rxnav(ndc)

        logger.debug("[DrugMapper] No mapping for NDC: %s", ndc)
        return None

    def map_ndc_batch(
        self, ndcs: List[str]
    ) -> Dict[str, Optional[DrugHarmonizationResult]]:
        """Batch-map a list of NDC codes. Returns {ndc: result_or_None}."""
        return {ndc: self.map_ndc(ndc) for ndc in ndcs}

    def map_drug_name(self, drug_name: str) -> Optional[DrugHarmonizationResult]:
        """
        Map a drug name (as stored in prescriptions.drug) to RxCUI + ATC codes.
        Uses the curated formulary map (case-insensitive).
        """
        key = drug_name.lower().strip()
        if key in _FORMULARY_NAME_MAP:
            rxcui, atc4, atc3 = _FORMULARY_NAME_MAP[key]
            return DrugHarmonizationResult(
                ndc="", rxcui=rxcui, drug_name=drug_name,
                atc4=atc4, atc3=atc3, source="curated"
            )
        return None

    def map_rxcui_to_atc(self, rxcui: str) -> Optional[Tuple[str, str]]:
        """
        Map a RxCUI to (ATC4, ATC3) codes.
        Returns None if mapping is unavailable.
        """
        # Check curated formulary
        if rxcui in _FORMULARY_RXCUI_MAP:
            _, atc4, atc3 = _FORMULARY_RXCUI_MAP[rxcui]
            return atc4, atc3

        # Check SafeDrug file
        if rxcui in self._rxcui2atc4:
            atc4 = self._rxcui2atc4[rxcui]
            atc3 = atc4[:4]
            return atc4, atc3

        return None

    def get_formulary_atc_matrix(self) -> pd.DataFrame:
        """
        Return a DataFrame summarising the ATC-level classifications for all
        8 formulary drugs. Useful for visualisation and report tables.

        Columns: drug_name, rxcui, ndc, atc3, atc4
        """
        rows = []
        for ndc, (rxcui, name, atc4, atc3) in _FORMULARY_NDC_MAP.items():
            rows.append(
                {
                    "drug_name": name,
                    "rxcui": rxcui,
                    "ndc": ndc,
                    "atc3": atc3,
                    "atc4": atc4,
                }
            )
        return pd.DataFrame(rows).set_index("drug_name")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_ndc(ndc: str) -> str:
        """Zero-pad NDC to 11 characters and strip spaces/dashes."""
        ndc = str(ndc).strip().replace("-", "").replace(" ", "")
        return ndc.zfill(11)[:11]

    def _load_rxnorm2rxcui(self, path: Path) -> None:
        """
        Load SafeDrug's rxnorm2RXCUI.txt.
        Expected format: tab-separated NDC <tab> RXCUI (no header).
        Reference: https://github.com/ycq091044/SafeDrug/tree/main/data
        """
        if not path.exists():
            logger.warning("[DrugMapper] rxnorm2RXCUI.txt not found at %s", path)
            return

        logger.info("[DrugMapper] Loading NDC -> RxCUI from %s ...", path)
        df = pd.read_csv(
            path,
            sep=r"\s+",
            header=None,
            names=["ndc", "rxcui"],
            dtype=str,
        )
        self._ndc2rxcui = {
            self._normalise_ndc(str(row["ndc"])): str(row["rxcui"]).strip()
            for _, row in df.iterrows()
        }
        logger.info("[DrugMapper] Loaded %d NDC -> RxCUI mappings.", len(self._ndc2rxcui))

    def _load_rxcui2atc4(self, path: Path) -> None:
        """
        Load SafeDrug's RXCUI2atc4.csv.
        Expected columns: YEAR, MONTH, NDC, RXCUI, ATC4
        ATC3 is derived by taking the first 4 characters of ATC4 (e.g. 'A01A').
        Reference: https://github.com/ycq091044/SafeDrug/tree/main/data
        """
        if not path.exists():
            logger.warning("[DrugMapper] RXCUI2atc4.csv not found at %s", path)
            return

        logger.info("[DrugMapper] Loading RxCUI -> ATC4 from %s ...", path)
        df = pd.read_csv(path, dtype=str)
        # Normalise column names (SafeDrug CSV uses uppercase)
        df.columns = df.columns.str.strip().str.upper()
        for _, row in df.dropna(subset=["RXCUI", "ATC4"]).iterrows():
            rxcui = str(row["RXCUI"]).strip()
            atc4 = str(row["ATC4"]).strip()
            if rxcui not in self._rxcui2atc4:
                self._rxcui2atc4[rxcui] = atc4
        logger.info("[DrugMapper] Loaded %d RxCUI -> ATC4 mappings.", len(self._rxcui2atc4))

    def _lookup_from_files(self, ndc: str) -> Optional[DrugHarmonizationResult]:
        """Attempt NDC -> RxCUI -> ATC4 resolution using SafeDrug file maps."""
        rxcui = self._ndc2rxcui.get(ndc)
        if not rxcui:
            return None

        atc4 = self._rxcui2atc4.get(rxcui)
        if not atc4:
            # RxCUI found but no ATC mapping
            return DrugHarmonizationResult(
                ndc=ndc, rxcui=rxcui, drug_name="",
                atc4="", atc3="", source="safedrug_files"
            )

        atc3 = atc4[:4]
        return DrugHarmonizationResult(
            ndc=ndc, rxcui=rxcui, drug_name="",
            atc4=atc4, atc3=atc3, source="safedrug_files"
        )

    def _lookup_from_rxnav(self, ndc: str) -> Optional[DrugHarmonizationResult]:
        """
        Query the NIH NLM RxNav REST API for NDC -> RxCUI -> ATC.
        Implements polite rate-limiting (default 0.2s between requests).

        API endpoints (no key required):
            NDC -> RxCUI: GET https://rxnav.nlm.nih.gov/REST/rxcui.json?idtype=NDC&id=<ndc>
            RxCUI -> ATC: GET https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json
                              ?rxcui=<rxcui>&relaSource=ATC
        """
        try:
            import urllib.request
        except ImportError:
            logger.error("[DrugMapper] urllib.request not available for API calls.")
            return None

        # Step 1: NDC -> RxCUI
        rxcui = self._rxnav_get_rxcui(ndc, urllib)
        if not rxcui:
            return None

        time.sleep(self._api_rate_limit)

        # Step 2: RxCUI -> ATC
        atc4, atc3 = self._rxnav_get_atc(rxcui, urllib) or ("", "")

        return DrugHarmonizationResult(
            ndc=ndc, rxcui=rxcui, drug_name="",
            atc4=atc4, atc3=atc3, source="rxnav_api"
        )

    @lru_cache(maxsize=512)
    def _rxnav_get_rxcui(self, ndc: str, urllib) -> Optional[str]:
        """Cached GET to RxNav NDC -> RxCUI endpoint."""
        url = self._RXNAV_NDC_URL.format(ndc=ndc)
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                data = json.loads(resp.read().decode())
            ids = (
                data.get("idGroup", {})
                    .get("rxnormId", [])
            )
            return ids[0] if ids else None
        except Exception as exc:
            logger.debug("[DrugMapper] RxNav NDC lookup failed for %s: %s", ndc, exc)
            return None

    @lru_cache(maxsize=512)
    def _rxnav_get_atc(self, rxcui: str, urllib) -> Optional[Tuple[str, str]]:
        """Cached GET to RxNav RxCUI -> ATC endpoint."""
        url = self._RXNAV_ATC_URL.format(rxcui=rxcui)
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                data = json.loads(resp.read().decode())
            classes = (
                data.get("rxclassDrugInfoList", {})
                    .get("rxclassDrugInfo", [])
            )
            for c in classes:
                atc4 = c.get("rxclassMinConceptItem", {}).get("classId", "")
                if atc4 and len(atc4) >= 5:  # ATC-4 codes are 5+ chars
                    return atc4, atc4[:4]
            return None
        except Exception as exc:
            logger.debug("[DrugMapper] RxNav ATC lookup failed for %s: %s", rxcui, exc)
            return None
