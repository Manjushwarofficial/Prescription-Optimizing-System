"""
SafeAudit-CDSS — backend/chemistry/ontology_mapper.py
======================================================
Drug-Ontology Cross-Reference & Therapeutic Class Substitute Resolver.
Grounded in:
  • GAMENet (AAAI 2019) Section 3.1 — Multi-source Clinical Vocabulary Alignment
  • Poly et al. (JMIR 2020) — ATC Therapeutic Taxonomy

Aligns clinical drug namespaces:
  • RxNorm CUI (National Library of Medicine)
  • ATC (WHO Anatomical Therapeutic Chemical classification, Level 3 and 4)
  • FDA National Drug Code (NDC)
  • Chemical Structure (RDKit Canonical SMILES)
  • Hospital Brand Names & Clinical Synonyms

Provides within-ATC-class substitute discovery for automated DDI clash resolution.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# Fallback seed synonyms for top ICU drugs
_COMMON_SYNONYMS: Dict[str, List[str]] = {
    "warfarin": ["coumadin", "jantoven"],
    "aspirin": ["acetylsalicylic acid", "asa", "bayer", "ecotrin"],
    "clopidogrel": ["plavix"],
    "heparin": ["hep-lock", "hepflush"],
    "apixaban": ["eliquis"],
    "rivaroxaban": ["xarelto"],
    "dabigatran": ["pradaxa"],
    "enoxaparin": ["lovenox"],
    "simvastatin": ["zocor"],
    "atorvastatin": ["lipitor"],
    "rosuvastatin": ["crestor"],
    "pravastatin": ["pravachol"],
    "fenofibrate": ["tricor", "antara"],
    "gemfibrozil": ["lopid"],
    "ezetimibe": ["zetia"],
    "amiodarone": ["cordarone", "pacerone"],
    "digoxin": ["lanoxin", "digox"],
    "lidocaine": ["xylocaine"],
    "flecainide": ["tambocor"],
    "verapamil": ["calan", "isoptin", "verelan"],
    "diltiazem": ["cardizem", "cartia", "tiazac"],
    "lisinopril": ["prinivil", "zestril"],
    "enalapril": ["vasotec"],
    "ramipril": ["altace"],
    "losartan": ["cozaar"],
    "valsartan": ["diovan"],
    "telmisartan": ["micardis"],
    "spironolactone": ["aldactone", "carospir"],
    "eplerenone": ["inspra"],
    "furosemide": ["lasix"],
    "hydrochlorothiazide": ["hctz", "microzide"],
    "torsemide": ["demadex"],
    "omeprazole": ["prilosec"],
    "esomeprazole": ["nexium"],
    "pantoprazole": ["protonix"],
    "rabeprazole": ["aciphex"],
    "famotidine": ["pepcid"],
    "ciprofloxacin": ["cipro"],
    "levofloxacin": ["levaquin"],
    "clarithromycin": ["biaxin"],
    "azithromycin": ["zithromax", "z-pak"],
    "metronidazole": ["flagyl"],
    "amoxicillin": ["amoxil", "trimox"],
    "vancomycin": ["vancocin"],
    "linezolid": ["zyvox"],
    "tramadol": ["ultram", "conzip"],
    "morphine": ["ms contin", "roxanol", "kadian"],
    "fentanyl": ["duragesic", "sublimaze"],
    "oxycodone": ["oxycontin", "roxybond"],
    "acetaminophen": ["paracetamol", "tylenol", "apap"],
    "ibuprofen": ["advil", "motrin"],
    "naproxen": ["aleve", "naprosyn"],
    "ketorolac": ["toradol"],
    "sertraline": ["zoloft"],
    "fluoxetine": ["prozac", "sarafem"],
    "paroxetine": ["paxil"],
    "citalopram": ["celexa"],
    "escitalopram": ["lexapro"],
    "venlafaxine": ["effexor"],
    "phenytoin": ["dilantin", "phenytek"],
    "carbamazepine": ["tegretol", "carbatrol"],
    "valproic acid": ["depakote", "depakene", "valproate"],
    "levetiracetam": ["keppra", "elepsia"],
    "gabapentin": ["neurontin", "gralise"],
    "lamotrigine": ["lamictal"],
    "metformin": ["glucophage", "fortamet"],
    "glipizide": ["glucotrol"],
    "sitagliptin": ["januvia"],
    "empagliflozin": ["jardiance"],
    "metoprolol": ["lopressor", "toprol-xl"],
    "carvedilol": ["coreg"],
    "atenolol": ["tenormin"],
    "propranolol": ["inderal"],
    "bisoprolol": ["zebeta"]
}


class OntologyMapper:
    """
    High-Performance Drug Ontology & Therapeutic Class Resolver.

    Supports indexing and O(1) resolution by:
      - Drug Name (canonical, e.g. "Warfarin")
      - Drug ID (e.g. "B01AA03")
      - RxCUI (e.g. "11289")
      - NDC Code (e.g. "00056-0170-70")
      - ATC-4 Code (e.g. "B01AA03")
      - ATC-3 Class (e.g. "B01A")
      - Brand Names / Synonyms (e.g. "Coumadin")
    """

    def __init__(
        self,
        formulary_path: Optional[Path] = None,
        extra_entries: Optional[List[Dict[str, Any]]] = None
    ) -> None:
        self._catalogue: Dict[str, Dict[str, Any]] = {}         # canonical_name -> record
        self._id_index: Dict[str, str] = {}                     # drug_id (lower) -> canonical_name
        self._alias_index: Dict[str, str] = {}                  # alias / brand / rxcui / ndc -> canonical_name
        self._atc3_to_drugs: Dict[str, Set[str]] = {}           # atc3_code -> set of canonical names
        self._atc4_to_drugs: Dict[str, Set[str]] = {}           # atc4_code -> set of canonical names
        self._ddi_lookup: Dict[Tuple[str, str], Dict[str, Any]] = {} # (drug_a, drug_b) -> ddi info

        # Auto-detect default formulary_drugs.json path
        if formulary_path is None:
            default_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "formulary_drugs.json"
            if default_path.exists():
                formulary_path = default_path

        # Load from formulary_drugs.json
        if formulary_path and Path(formulary_path).exists():
            with open(formulary_path, "r", encoding="utf-8") as fh:
                entries = json.load(fh)
                self._load_entries(entries)

        if extra_entries:
            self._load_entries(extra_entries)

        # Load DDI pairs if available
        ddi_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "ddi_pairs.json"
        if ddi_path.exists():
            try:
                with open(ddi_path, "r", encoding="utf-8") as fh:
                    pairs = json.load(fh)
                    for p in pairs:
                        na = p["drug_a_name"].lower()
                        nb = p["drug_b_name"].lower()
                        ida = p["drug_a_id"].lower()
                        idb = p["drug_b_id"].lower()
                        self._ddi_lookup[(na, nb)] = p
                        self._ddi_lookup[(nb, na)] = p
                        self._ddi_lookup[(ida, idb)] = p
                        self._ddi_lookup[(idb, ida)] = p
            except Exception as e:
                logger.warning("Could not index ddi_pairs: %s", e)

        logger.info(
            "OntologyMapper initialized — %d canonical drugs, %d indexed aliases across %d ATC-3 classes",
            len(self._catalogue),
            len(self._alias_index),
            len(self._atc3_to_drugs)
        )

    # ------------------------------------------------------------------
    # Resolution API
    # ------------------------------------------------------------------

    def resolve(self, identifier: str) -> Optional[Dict[str, Any]]:
        """
        Resolve any drug identifier (name, ID, RxCUI, NDC, brand synonym)
        to its canonical formulary record. Case-insensitive and whitespace-tolerant.
        """
        if not identifier:
            return None
        key = identifier.strip().lower()

        # 1. Direct ID match
        if key in self._id_index:
            return dict(self._catalogue[self._id_index[key]])

        # 2. Canonical name match
        if key in self._catalogue:
            return dict(self._catalogue[key])

        # 3. Alias / RxCUI / NDC match
        if key in self._alias_index:
            canonical = self._alias_index[key]
            return dict(self._catalogue[canonical])

        return None

    def resolve_many(self, identifiers: List[str]) -> Dict[str, Optional[Dict[str, Any]]]:
        """Resolve a batch of drug identifiers."""
        return {item: self.resolve(item) for item in identifiers}

    def get_smiles(self, identifier: str) -> Optional[str]:
        """Return the canonical SMILES string for a drug."""
        rec = self.resolve(identifier)
        return rec.get("smiles") if rec else None

    def get_atc_code(self, identifier: str) -> Optional[str]:
        """Return the ATC-4 code (e.g. 'B01AA03')."""
        rec = self.resolve(identifier)
        return rec.get("atc4_code") if rec else None

    def get_atc3_code(self, identifier: str) -> Optional[str]:
        """Return the ATC-3 class code (e.g. 'B01A')."""
        rec = self.resolve(identifier)
        return rec.get("atc3_code") if rec else None

    def get_drug_id(self, identifier: str) -> Optional[str]:
        """Return standard drug_id."""
        rec = self.resolve(identifier)
        return rec.get("drug_id") if rec else None

    def get_rxcui(self, identifier: str) -> Optional[str]:
        """Return RxNorm Concept Unique Identifier."""
        rec = self.resolve(identifier)
        return rec.get("rxcui") if rec else None

    # ------------------------------------------------------------------
    # Therapeutic Substitutions & Class Alignment
    # ------------------------------------------------------------------

    def get_substitutes_in_class(self, identifier: str) -> List[Dict[str, Any]]:
        """
        Find all other drugs within the same ATC-3 therapeutic family.
        Key for suggesting safe substitutes where D_i,j' = 0.
        """
        rec = self.resolve(identifier)
        if not rec:
            return []

        atc3 = rec.get("atc3_code")
        canonical = rec["name"].lower()
        if not atc3 or atc3 not in self._atc3_to_drugs:
            return []

        substitutes: List[Dict[str, Any]] = []
        for other_name in sorted(self._atc3_to_drugs[atc3]):
            if other_name != canonical:
                substitutes.append(dict(self._catalogue[other_name]))

        return substitutes

    def atc_class_overlap(self, drug_a: str, drug_b: str) -> bool:
        """True if two drugs share the same ATC-3 class (e.g. both 'B01A')."""
        c_a = self.get_atc3_code(drug_a)
        c_b = self.get_atc3_code(drug_b)
        if not c_a or not c_b:
            return False
        return c_a == c_b

    # ------------------------------------------------------------------
    # Properties & Catalogues
    # ------------------------------------------------------------------

    def get_ddi_pair(self, drug_a: str, drug_b: str) -> Optional[Dict[str, Any]]:
        """Lookup curated TwoSIDES DDI details between two drugs if known."""
        rec_a = self.resolve(drug_a)
        rec_b = self.resolve(drug_b)
        na = (rec_a["name"] if rec_a else drug_a).strip().lower()
        nb = (rec_b["name"] if rec_b else drug_b).strip().lower()
        ida = (rec_a["drug_id"] if rec_a else drug_a).strip().lower()
        idb = (rec_b["drug_id"] if rec_b else drug_b).strip().lower()
        return self._ddi_lookup.get((na, nb)) or self._ddi_lookup.get((ida, idb))

    def list_all(self) -> List[Dict[str, Any]]:
        """Return a list of all canonical drug records."""
        return [dict(r) for r in self._catalogue.values()]

    @property
    def formulary(self) -> List[Dict[str, Any]]:
        """Property returning list of all formulary drug records."""
        return self.list_all()

    @property
    def drug_names(self) -> List[str]:
        """Alphabetical list of canonical drug names."""
        return sorted([rec["name"] for rec in self._catalogue.values()])

    @property
    def drug_ids(self) -> List[str]:
        """Alphabetical list of drug IDs."""
        return sorted([rec["drug_id"] for rec in self._catalogue.values()])

    @property
    def smiles_dict(self) -> Dict[str, str]:
        """Mapping from canonical drug name to SMILES."""
        return {rec["name"]: rec["smiles"] for rec in self._catalogue.values() if "smiles" in rec}

    def all_drugs(self) -> List[Dict[str, Any]]:
        """Return a copy of all drug records."""
        return [dict(r) for r in self._catalogue.values()]

    # ------------------------------------------------------------------
    # Internal Indexing
    # ------------------------------------------------------------------

    def _load_entries(self, entries: List[Dict[str, Any]]) -> None:
        for entry in entries:
            name = entry["name"].strip()
            canonical = name.lower()
            drug_id = entry.get("drug_id", canonical).strip()
            atc3 = entry.get("atc3_code", "").strip()
            atc4 = entry.get("atc4_code", "").strip()
            rxcui = str(entry.get("rxcui", "")).strip()
            ndc = str(entry.get("ndc_code", "")).strip()

            # Store record
            record = dict(entry)
            record["name"] = name
            self._catalogue[canonical] = record

            # Index drug_id
            self._id_index[drug_id.lower()] = canonical

            # Index identifiers
            self._alias_index[canonical] = canonical
            self._alias_index[drug_id.lower()] = canonical
            if rxcui:
                self._alias_index[rxcui.lower()] = canonical
            if ndc:
                self._alias_index[ndc.lower()] = canonical
            if atc4:
                self._alias_index[atc4.lower()] = canonical

            # Index synonyms
            synonyms = entry.get("synonyms", []) + _COMMON_SYNONYMS.get(canonical, [])
            for syn in synonyms:
                s_clean = syn.strip().lower()
                if s_clean not in self._alias_index:
                    self._alias_index[s_clean] = canonical

            # Index ATC classes
            if atc3:
                self._atc3_to_drugs.setdefault(atc3, set()).add(canonical)
            if atc4:
                self._atc4_to_drugs.setdefault(atc4, set()).add(canonical)

    def save(self, out_path: Path) -> None:
        """Persist ontology mapping to JSON."""
        out_path = Path(out_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"catalogue": list(self._catalogue.values())}
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)

    @classmethod
    def load(cls, json_path: Path) -> "OntologyMapper":
        """Load from a JSON file."""
        with open(json_path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        catalogue = payload.get("catalogue", payload) if isinstance(payload, dict) else payload
        return cls(extra_entries=catalogue)

    def __repr__(self) -> str:
        return f"OntologyMapper(drugs={len(self._catalogue)}, aliases={len(self._alias_index)}, atc3_classes={len(self._atc3_to_drugs)})"
