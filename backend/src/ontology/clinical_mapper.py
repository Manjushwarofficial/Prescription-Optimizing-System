"""
clinical_mapper.py
==================
Input Ontological Standardization Module (Phase 2 upgrade).

Replaces the static _SYMPTOM_SYNONYMS regex dictionary with a deterministic
clinical vocabulary harmonization pipeline that maps raw patient symptoms and
historical diagnoses to standardized ICD-10-CM and SNOMED CT concept identifiers.

Key capabilities:
    1. ICD-10 lookup from raw symptom strings via curated + UMLS-derived map
    2. SNOMED CT concept mapping (concept ID + preferred term)
    3. Lowest Common Ancestor (LCA) graph traversal over the polyhierarchical
       SNOMED CT 'Is a' (116680003) relationship DAG to unify conflicting or
       overly broad ICD-10 classifications into the most specific shared concept
    4. Offline / mock mode for CI testing without live API keys

Schema references:
    - SNOMED CT to ICD-10-CM crosswalk (Extended Map RF2):
      https://www.nlm.nih.gov/research/umls/mapping_projects/snomedct_to_icd10cm.html
      tls_Icd10cmHumanReadableMap.tsv columns:
          referencedComponentId, referencedComponentName, mapGroup,
          mapPriority, mapRule, mapTarget
    - SNOMED CT relationship file (RF2):
      sct2_Relationship_Full.txt columns:
          sourceId, destinationId, typeId, active
      Filter: typeId == '116680003' (Is a) AND active == 1

SNOMED CT hierarchical IS-A edges are built into a NetworkX DiGraph from which
networkx.lowest_common_ancestor() is called to unify conflicting codes.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, FrozenSet, List, Optional, Set, Tuple

import networkx as nx
import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Curated fallback vocabulary (covers our 8-drug formulary symptom space)
# Extends _SYMPTOM_SYNONYMS by mapping to both SNOMED CT concept IDs and ICD-10
# ---------------------------------------------------------------------------

# Format: raw_text_key -> (snomed_concept_id, preferred_term, icd10_code)
_CURATED_VOCAB: Dict[str, Tuple[str, str, str]] = {
    # Exact matches
    "hypertension":         ("38341003",  "Hypertension",                             "I10"),
    "heart_failure":        ("84114007",  "Heart failure",                            "I50.9"),
    "edema":                ("267038008", "Edema",                                    "R60.9"),
    "pain":                 ("22253000",  "Pain",                                     "R52"),
    "inflammation":         ("23583003",  "Inflammation",                             "M79.3"),
    "fever":                ("386661006", "Fever",                                    "R50.9"),
    "acid_reflux":          ("235595009", "Gastroesophageal reflux disease",          "K21.9"),
    "peptic_ulcer":         ("13200003",  "Peptic ulcer disease",                     "K27.9"),
    "type2_diabetes":       ("44054006",  "Type 2 diabetes mellitus",                 "E11.9"),
    "hyperlipidemia":       ("55822004",  "Hyperlipidemia",                           "E78.5"),
    "angina":               ("194828000", "Angina pectoris",                          "I20.9"),
    "bacterial_infection":  ("87628006",  "Bacterial infectious disease",             "A49.9"),
    "pneumonia":            ("233604007", "Pneumonia",                                "J18.9"),
    "renal_impairment":     ("723188008", "Renal impairment",                         "N28.9"),
    # Synonym expansions (replaces regex _SYMPTOM_SYNONYMS)
    "pyrexia":              ("386661006", "Fever",                                    "R50.9"),
    "pyrexia of unknown origin": ("386661006", "Fever",                              "R50.9"),
    "high blood pressure":  ("38341003",  "Hypertension",                             "I10"),
    "htn":                  ("38341003",  "Hypertension",                             "I10"),
    "chf":                  ("84114007",  "Heart failure",                            "I50.9"),
    "congestive heart failure": ("84114007", "Heart failure",                        "I50.9"),
    "swelling":             ("267038008", "Edema",                                    "R60.9"),
    "gerd":                 ("235595009", "Gastroesophageal reflux disease",          "K21.9"),
    "gastroesophageal reflux": ("235595009", "Gastroesophageal reflux disease",      "K21.9"),
    "peptic ulcer":         ("13200003",  "Peptic ulcer disease",                     "K27.9"),
    "t2dm":                 ("44054006",  "Type 2 diabetes mellitus",                 "E11.9"),
    "dm2":                  ("44054006",  "Type 2 diabetes mellitus",                 "E11.9"),
    "dyslipidaemia":        ("55822004",  "Hyperlipidemia",                           "E78.5"),
    "dyslipidemia":         ("55822004",  "Hyperlipidemia",                           "E78.5"),
    "stable angina":        ("194828000", "Angina pectoris",                          "I20.9"),
    "chest pain":           ("29857009",  "Chest pain",                               "R07.9"),
    "bacterial pneumonia":  ("233604007", "Pneumonia",                                "J18.9"),
    "renal failure":        ("42399005",  "Renal failure syndrome",                   "N19"),
    "ckd":                  ("709044004", "Chronic kidney disease",                   "N18.9"),
    "chronic kidney disease": ("709044004","Chronic kidney disease",                  "N18.9"),
}


class ConceptMapping:
    """Result of a successful concept mapping lookup."""

    __slots__ = ("raw_text", "snomed_id", "preferred_term", "icd10_code", "source")

    def __init__(
        self,
        raw_text: str,
        snomed_id: str,
        preferred_term: str,
        icd10_code: str,
        source: str = "curated",
    ):
        self.raw_text = raw_text
        self.snomed_id = snomed_id
        self.preferred_term = preferred_term
        self.icd10_code = icd10_code
        self.source = source  # 'curated' | 'rf2_crosswalk' | 'rxnav_api'

    def __repr__(self) -> str:
        return (
            f"ConceptMapping(raw='{self.raw_text}', "
            f"snomed={self.snomed_id}, icd10={self.icd10_code})"
        )

    def to_dict(self) -> Dict:
        return {
            "raw_text": self.raw_text,
            "snomed_id": self.snomed_id,
            "preferred_term": self.preferred_term,
            "icd10_code": self.icd10_code,
            "source": self.source,
        }


class ClinicalOntologyMapper:
    """
    Deterministic clinical vocabulary harmonization module.

    Maps raw patient symptom strings and historical ICD codes to standardized
    SNOMED CT concept IDs and ICD-10-CM codes. Supports optional loading of the
    full SNOMED CT RF2 Extended Map and Relationship file for LCA computation.

    Usage (curated vocabulary only, no external files):
        >>> mapper = ClinicalOntologyMapper()
        >>> result = mapper.map_symptom("pyrexia")
        >>> result.icd10_code
        'R50.9'

    Usage (with full SNOMED CT files):
        >>> mapper = ClinicalOntologyMapper(
        ...     rf2_crosswalk_path="data/tls_Icd10cmHumanReadableMap.tsv",
        ...     rf2_relationship_path="data/sct2_Relationship_Full.txt",
        ... )
        >>> ancestor = mapper.lowest_common_ancestor("I10", "I50.9")
    """

    # SNOMED CT 'Is a' relationship type ID
    IS_A_TYPE_ID = "116680003"

    def __init__(
        self,
        rf2_crosswalk_path: Optional[str] = None,
        rf2_relationship_path: Optional[str] = None,
    ):
        """
        Parameters
        ----------
        rf2_crosswalk_path    : Path to tls_Icd10cmHumanReadableMap.tsv
                                (SNOMED CT -> ICD-10 extended map). If None,
                                only the curated vocabulary is used.
        rf2_relationship_path : Path to sct2_Relationship_Full.txt (RF2 format)
                                for polyhierarchy LCA traversal. If None,
                                the SNOMED hierarchy DAG is not built.
        """
        self._vocab: Dict[str, Tuple[str, str, str]] = dict(_CURATED_VOCAB)
        self._snomed_dag: Optional[nx.DiGraph] = None
        self._icd10_to_snomed: Dict[str, str] = {}  # icd10 -> snomed_id

        if rf2_crosswalk_path:
            self._load_rf2_crosswalk(Path(rf2_crosswalk_path))

        if rf2_relationship_path:
            self._build_snomed_dag(Path(rf2_relationship_path))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def map_symptom(self, raw_text: str) -> Optional[ConceptMapping]:
        """
        Map a raw symptom string to its standardized clinical concept.

        Normalisation pipeline:
            1. Lowercase + strip whitespace
            2. Replace hyphens and underscores with spaces
            3. Exact lookup in curated vocabulary (covers synonyms/abbreviations)
            4. Partial match fallback (longest substring match)

        Returns None if no mapping is found.
        """
        normalised = self._normalise(raw_text)
        if normalised in self._vocab:
            snomed_id, term, icd10 = self._vocab[normalised]
            return ConceptMapping(raw_text, snomed_id, term, icd10, source="curated")

        # Partial / substring fallback
        best_key = self._partial_match(normalised)
        if best_key:
            snomed_id, term, icd10 = self._vocab[best_key]
            return ConceptMapping(raw_text, snomed_id, term, icd10, source="partial_match")

        logger.debug("No mapping found for symptom: '%s'", raw_text)
        return None

    def map_icd10_to_snomed(self, icd10_code: str) -> Optional[str]:
        """
        Look up the SNOMED CT concept ID for a given ICD-10 code.
        Returns None if no mapping is available.
        """
        return self._icd10_to_snomed.get(icd10_code.strip())

    def map_symptom_batch(self, raw_texts: List[str]) -> Dict[str, Optional[ConceptMapping]]:
        """Batch-map a list of symptom strings. Returns {raw_text: mapping_or_None}."""
        return {t: self.map_symptom(t) for t in raw_texts}

    def extract_icd10_set(self, raw_symptoms: List[str]) -> FrozenSet[str]:
        """
        Map raw symptom strings to a frozenset of ICD-10 codes,
        silently dropping any unmappable entries.
        """
        codes: Set[str] = set()
        for sym in raw_symptoms:
            m = self.map_symptom(sym)
            if m:
                codes.add(m.icd10_code)
        return frozenset(codes)

    def lowest_common_ancestor(
        self, icd10_a: str, icd10_b: str
    ) -> Optional[str]:
        """
        Compute the Lowest Common Ancestor (LCA) of two ICD-10 codes in the
        SNOMED CT polyhierarchy DAG, returning the SNOMED CT concept ID of their
        most specific shared ancestor.

        Requires rf2_relationship_path to have been provided at construction.

        Algorithm:
            1. Resolve both ICD-10 codes to their SNOMED CT concept IDs
            2. Call networkx.lowest_common_ancestor() on the SNOMED DAG
               (edges directed child -> parent, i.e., 'Is a' relationships)
            3. Return the ancestor SNOMED concept ID

        Returns None if the DAG is unavailable or either code cannot be mapped.
        """
        if self._snomed_dag is None:
            logger.warning(
                "SNOMED DAG not loaded — provide rf2_relationship_path. "
                "Cannot compute LCA."
            )
            return None

        snomed_a = self.map_icd10_to_snomed(icd10_a)
        snomed_b = self.map_icd10_to_snomed(icd10_b)

        if snomed_a is None or snomed_b is None:
            logger.debug(
                "LCA: could not resolve ICD-10 codes '%s' -> '%s', '%s' -> '%s'",
                icd10_a, snomed_a, icd10_b, snomed_b,
            )
            return None

        if snomed_a not in self._snomed_dag or snomed_b not in self._snomed_dag:
            return None

        try:
            lca_node = nx.lowest_common_ancestor(
                self._snomed_dag, snomed_a, snomed_b
            )
            return lca_node
        except nx.NetworkXError as exc:
            logger.debug("LCA computation failed: %s", exc)
            return None

    def unify_icd10_set(self, icd10_codes: FrozenSet[str]) -> FrozenSet[str]:
        """
        Unify a set of ICD-10 codes by computing pairwise LCAs and collapsing
        overly broad or conflicting codes into their most specific shared ancestor.
        Falls back to returning the input set unchanged if the SNOMED DAG is absent.
        """
        if self._snomed_dag is None or len(icd10_codes) < 2:
            return icd10_codes

        unified: Set[str] = set(icd10_codes)
        codes_list = list(icd10_codes)
        for i in range(len(codes_list)):
            for j in range(i + 1, len(codes_list)):
                lca = self.lowest_common_ancestor(codes_list[i], codes_list[j])
                if lca:
                    # Map SNOMED LCA back to ICD-10 if possible
                    icd10_lca = next(
                        (k for k, v in self._icd10_to_snomed.items() if v == lca),
                        None,
                    )
                    if icd10_lca and icd10_lca not in unified:
                        unified.add(icd10_lca)
        return frozenset(unified)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise(text: str) -> str:
        """Lowercase, strip, replace separators with spaces."""
        return text.lower().strip().replace("_", " ").replace("-", " ")

    def _partial_match(self, normalised: str) -> Optional[str]:
        """Return the longest vocabulary key that is a substring of normalised."""
        candidates = [k for k in self._vocab if k in normalised]
        if not candidates:
            return None
        return max(candidates, key=len)

    def _load_rf2_crosswalk(self, path: Path) -> None:
        """
        Load the SNOMED CT -> ICD-10-CM Extended Map (tls_Icd10cmHumanReadableMap.tsv).

        Expected columns (tab-separated):
            referencedComponentId, referencedComponentName, mapGroup,
            mapPriority, mapRule, mapTarget
        """
        if not path.exists():
            logger.warning("[ClinicalMapper] RF2 crosswalk file not found: %s", path)
            return

        logger.info("[ClinicalMapper] Loading RF2 ICD-10 crosswalk from %s ...", path)
        df = pd.read_csv(
            path,
            sep="\t",
            usecols=["referencedComponentId", "referencedComponentName", "mapTarget"],
            dtype=str,
        )
        df = df.dropna(subset=["mapTarget"])

        for _, row in df.iterrows():
            snomed_id = str(row["referencedComponentId"]).strip()
            preferred_term = str(row["referencedComponentName"]).strip()
            icd10_code = str(row["mapTarget"]).strip()

            # Register in reverse lookup (ICD-10 -> SNOMED)
            if icd10_code not in self._icd10_to_snomed:
                self._icd10_to_snomed[icd10_code] = snomed_id

            # Add to vocabulary using preferred term as key
            norm_term = self._normalise(preferred_term)
            if norm_term not in self._vocab:
                self._vocab[norm_term] = (snomed_id, preferred_term, icd10_code)

        logger.info(
            "[ClinicalMapper] RF2 crosswalk loaded: %d ICD-10 -> SNOMED mappings.",
            len(self._icd10_to_snomed),
        )

    def _build_snomed_dag(self, path: Path) -> None:
        """
        Build a NetworkX DiGraph from the SNOMED CT Relationship file (RF2).

        Expected columns (tab-separated):
            id, effectiveTime, active, moduleId, sourceId, destinationId,
            relationshipGroup, typeId, characteristicTypeId, modifierId

        Filters to:
            typeId == '116680003' (Is a) AND active == '1'

        Edge direction: child (sourceId) -> parent (destinationId),
        matching networkx.lowest_common_ancestor() semantics (DAG flows up).
        """
        if not path.exists():
            logger.warning("[ClinicalMapper] SNOMED relationship file not found: %s", path)
            return

        logger.info("[ClinicalMapper] Building SNOMED CT hierarchy DAG from %s ...", path)
        df = pd.read_csv(
            path,
            sep="\t",
            usecols=["active", "sourceId", "destinationId", "typeId"],
            dtype=str,
        )
        # Filter to active 'Is a' relationships
        is_a = df[
            (df["typeId"] == self.IS_A_TYPE_ID) & (df["active"] == "1")
        ]

        dag = nx.DiGraph()
        for _, row in is_a.iterrows():
            child = row["sourceId"].strip()
            parent = row["destinationId"].strip()
            dag.add_edge(child, parent)  # child -> parent (upward DAG)

        self._snomed_dag = dag
        logger.info(
            "[ClinicalMapper] SNOMED CT DAG built: %d nodes, %d edges.",
            dag.number_of_nodes(),
            dag.number_of_edges(),
        )


# ---------------------------------------------------------------------------
# Mock data for unit tests
# ---------------------------------------------------------------------------

def get_mock_mapper() -> ClinicalOntologyMapper:
    """
    Return a ClinicalOntologyMapper initialised with only the curated vocabulary
    (no RF2 files required). Suitable for CI and unit tests.
    """
    return ClinicalOntologyMapper()


def generate_mock_snomed_dag() -> nx.DiGraph:
    """
    Generate a minimal mock SNOMED CT 'Is a' DAG for testing LCA computation.
    Covers a small subset of the cardiovascular and metabolic concept hierarchy.
    """
    dag = nx.DiGraph()
    # Simplified SNOMED hierarchy (child -> parent edges)
    edges = [
        ("38341003",  "64572001"),   # Hypertension -> Disease
        ("84114007",  "64572001"),   # Heart failure -> Disease
        ("44054006",  "64572001"),   # Type 2 DM -> Disease
        ("194828000", "64572001"),   # Angina pectoris -> Disease
        ("55822004",  "64572001"),   # Hyperlipidemia -> Disease
        ("64572001",  "404684003"),  # Disease -> Clinical finding
    ]
    dag.add_edges_from(edges)
    return dag
