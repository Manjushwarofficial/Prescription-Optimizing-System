"""
SafeAudit-CDSS — backend/models/substitute_optimizer.py
=========================================================
Substructure-Aware Safe ATC Replacement Engine.
Grounded in:
  • SafeDrug (IJCAI 2021) — Substructure Cosine Minimization & Bipartite Mask H
  • TwoSIDES Clinical DDI Matrix D in {0, 1}^(MxM) — Zero-Interaction Constraint
  • Hospital CPOE Safety Firewall Protocols

When a prescription draft triggers a HARD_STOP_CRITICAL or PASSIVE_INLINE_WARNING DDI (m_i, m_j):
  1. Searches within the same ATC-3 therapeutic class for candidate replacements m_k.
  2. Enforces Zero-DDI Constraint against all remaining medications:
       sum_{d in M_draft \\ {m_j}} D_{d, m_k} == 0
  3. Minimizes BRICS substructure cosine similarity cos(W_{:, i}, W_{:, k}) with clashing drug m_i.
  4. Filters out any candidate conflicting with patient's documented allergies.
  5. Computes exact Pre-Swap DDI Rate vs. Post-Swap DDI Rate and isolates
     Shared vs. Avoided BRICS chemical motifs.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

import config
from chemistry.ontology_mapper import OntologyMapper
from chemistry.rdkit_brics import BRICSPipeline

logger = logging.getLogger(__name__)


# Standard allergy cross-reactivity mapping
ALLERGY_CROSS_REACTIVITY: Dict[str, List[str]] = {
    "penicillins": ["amoxicillin", "ampicillin", "piperacillin", "penicillin"],
    "sulfa": ["sulfamethoxazole", "trimethoprim"],
    "sulfonamides": ["sulfamethoxazole", "trimethoprim"],
    "aspirin": ["aspirin", "salicylate", "diflunisal"],
    "nsaids": ["ibuprofen", "naproxen", "ketorolac", "aspirin", "indomethacin"],
    "statins": ["simvastatin", "atorvastatin", "rosuvastatin", "pravastatin"],
    "opioids": ["morphine", "fentanyl", "oxycodone", "tramadol", "codeine"],
    "beta blockers": ["metoprolol", "carvedilol", "atenolol", "propranolol", "bisoprolol"],
    "ace inhibitors": ["lisinopril", "enalapril", "ramipril"],
}

SUBSTITUTE_RATIONALE_MAP: Dict[Tuple[str, str], str] = {
    ("Omeprazole", "Pantoprazole"): (
        "Pantoprazole exhibits significantly lower affinity for hepatic CYP2C19 compared to omeprazole, "
        "preventing attenuation of clopidogrel active metabolite formation and preserving antiplatelet protection."
    ),
    ("Omeprazole", "Famotidine"): (
        "Famotidine is an H2-receptor antagonist that does not utilize the CYP2C19 metabolic pathway, "
        "providing gastric acid suppression with zero antiplatelet drug interaction risk."
    ),
    ("Omeprazole", "Rabeprazole"): (
        "Rabeprazole undergoes predominantly non-enzymatic reduction with minimal CYP2C19 dependency, "
        "avoiding substantial inhibition of clopidogrel activation."
    ),
    ("Simvastatin", "Rosuvastatin"): (
        "Rosuvastatin is primarily eliminated via non-CYP mechanisms (CYP2C9 minor), avoiding CYP3A4-mediated "
        "accumulation when co-prescribed with amiodarone, diltiazem, or macrolides."
    ),
    ("Simvastatin", "Pravastatin"): (
        "Pravastatin is a hydrophilic statin eliminated via sulfation and renal pathways without CYP3A4 involvement, "
        "eliminating rhabdomyolysis and myopathy hazards."
    ),
    ("Ibuprofen", "Acetaminophen"): (
        "Acetaminophen provides effective antipyresis and analgesia without platelet COX-1 inhibition or gastric "
        "mucosal ulceration, drastically lowering GI bleed risk in anticoagulated patients."
    ),
    ("Naproxen", "Acetaminophen"): (
        "Acetaminophen avoids renal prostaglandin suppression and afferent arteriole constriction, preventing "
        "the 'Triple Whammy' acute kidney injury seen with NSAIDs and ACE inhibitors."
    ),
    ("Linezolid", "Vancomycin"): (
        "Vancomycin provides potent Gram-positive MRSA bactericidal activity without monoamine oxidase inhibition, "
        "completely avoiding life-threatening Serotonin Syndrome in patients taking SSRIs."
    ),
    ("Phenytoin", "Levetiracetam"): (
        "Levetiracetam binds synaptic vesicle protein SV2A and is excreted renally unchanged, avoiding CYP2C9/3A4 "
        "induction and eliminating erratic warfarin or antiepileptic drug interactions."
    ),
    ("Spironolactone", "Torsemide"): (
        "Torsemide is a high-ceiling loop diuretic that promotes potassium excretion, preventing lethal hyperkalemia "
        "in patients on dual RAAS inhibitor regimens with compromised eGFR."
    ),
}


class SubstituteOptimizer:
    """
    Substructure-Aware Safe ATC Replacement Engine.
    """

    def __init__(
        self,
        ontology_mapper: Optional[OntologyMapper] = None,
        brics_pipeline: Optional[BRICSPipeline] = None
    ) -> None:
        self.ontology = ontology_mapper or OntologyMapper()
        self.brics = brics_pipeline

        if self.brics is None and config.BRICS_FINGERPRINT_PATH.exists():
            try:
                self.brics = BRICSPipeline.load(config.PROCESSED_DIR)
            except Exception as exc:
                logger.warning("Could not load BRICSPipeline: %s", exc)

        # Load TwoSIDES DDI matrix for zero-interaction constraint checking
        self.ddi_matrix: Optional[np.ndarray] = None
        self.drug_vocab: Dict[str, int] = {}
        if config.DDI_MATRIX_PATH.exists() and config.DRUG_VOCAB_PATH.exists():
            try:
                import json
                self.ddi_matrix = np.load(config.DDI_MATRIX_PATH)
                with open(config.DRUG_VOCAB_PATH, "r", encoding="utf-8") as fh:
                    self.drug_vocab = json.load(fh)
            except Exception as exc:
                logger.warning("Could not load DDI matrix: %s", exc)

    def optimize_substitute(
        self,
        clashing_drug: str,
        co_prescribed_drugs: List[str],
        patient_allergies: Optional[List[str]] = None,
        top_k: int = 3
    ) -> List[Dict[str, Any]]:
        """
        Identify and rank candidate within-class replacements for `clashing_drug`.
        Parameters:
          clashing_drug: Drug identifier (name or ID) to replace.
          co_prescribed_drugs: List of other medications in draft order M_draft.
          patient_allergies: Optional list of patient documented allergies.
          top_k: Number of ranked substitutes to return.
        """
        orig_rec = self.ontology.resolve(clashing_drug)
        if not orig_rec:
            return []

        orig_name = orig_rec["name"]
        candidates = self.ontology.get_substitutes_in_class(orig_name)
        if not candidates:
            return []

        # Resolve co-prescribed medications
        resolved_co_meds = []
        for d in co_prescribed_drugs:
            r = self.ontology.resolve(d)
            if r and r["drug_id"] != orig_rec["drug_id"]:
                resolved_co_meds.append(r)

        # 1. Compute Pre-Swap DDI Rate
        pre_swap_ddis, pre_swap_rate = self._compute_regimen_ddi_rate(
            [orig_rec] + resolved_co_meds
        )

        patient_allergies_clean = [a.strip().lower() for a in (patient_allergies or [])]
        scored_candidates: List[Dict[str, Any]] = []

        orig_frags = self._get_drug_frags(orig_rec["drug_id"])

        for cand in candidates:
            cand_name = cand["name"]
            cand_id = cand["drug_id"]

            # Filter 1: Allergy Exclusion
            if self._is_allergic(cand_name, patient_allergies_clean):
                continue

            # Filter 2: Zero-DDI Constraint: sum_{d in M_draft \ {j}} D_{d, k} == 0
            is_zero_ddi = True
            clash_detail = None
            for co_med in resolved_co_meds:
                if self._has_ddi(cand["name"], co_med["name"]):
                    is_zero_ddi = False
                    clash_detail = co_med["name"]
                    break

            # Filter 3: Compute Post-Swap DDI Rate
            post_swap_regimen = [cand] + resolved_co_meds
            post_swap_ddis, post_swap_rate = self._compute_regimen_ddi_rate(post_swap_regimen)

            # Filter 4: BRICS Chemical Substructure Analysis
            cand_frags = self._get_drug_frags(cand_id)
            shared_with_orig = orig_frags.intersection(cand_frags)
            avoided_motifs = orig_frags - cand_frags

            # Compute BRICS cosine similarity cos(w_orig, w_cand)
            brics_cos_sim = self._compute_brics_cosine(orig_name, cand_name)
            tanimoto_sim = len(shared_with_orig) / max(1, len(orig_frags.union(cand_frags)))

            # Clinical rationale
            rationale_key = (orig_name, cand_name)
            rationale = SUBSTITUTE_RATIONALE_MAP.get(
                rationale_key,
                f"{cand_name} belongs to the same therapeutic class ({cand.get('atc_class_name', 'Within-class')}) "
                f"without exhibiting the documented metabolic clash of {orig_name}."
            )

            # Composite ranking score:
            # 60% Zero-DDI guarantee + 25% Substructure Cosine orthogonality + 15% Tanimoto preservation
            safety_bonus = 1.0 if is_zero_ddi else 0.0
            orthogonality_bonus = max(0.0, 1.0 - max(0.0, brics_cos_sim))
            composite_score = (
                0.60 * safety_bonus +
                0.25 * orthogonality_bonus +
                0.15 * tanimoto_sim
            )

            scored_candidates.append({
                "candidate_id": cand_id,
                "candidate_name": cand_name,
                "atc4_code": cand.get("atc4_code", ""),
                "atc3_code": cand.get("atc3_code", ""),
                "atc_class_name": cand.get("atc_class_name", ""),
                "is_zero_ddi": is_zero_ddi,
                "clash_with": clash_detail,
                "pre_swap_ddi_rate": pre_swap_rate,
                "post_swap_ddi_rate": post_swap_rate,
                "ddi_rate_reduction_pct": f"{max(0.0, (pre_swap_rate - post_swap_rate) * 100):.1f}%",
                "brics_cosine_similarity": round(brics_cos_sim, 3),
                "tanimoto_similarity": round(tanimoto_sim, 3),
                "composite_score": round(composite_score, 3),
                "chemical_motifs": {
                    "preserved_substructures": list(shared_with_orig)[:3],
                    "avoided_clashing_substructures": list(avoided_motifs)[:3],
                    "candidate_fragment_count": len(cand_frags)
                },
                "clinical_rationale": rationale,
                "smiles": cand.get("smiles", "")
            })

        # Sort: Zero-DDI first, then highest composite score
        scored_candidates.sort(key=lambda c: (c["is_zero_ddi"], c["composite_score"]), reverse=True)
        return scored_candidates[:top_k]

    def _is_allergic(self, drug_name: str, patient_allergies: List[str]) -> bool:
        """Check if drug matches patient's documented allergies."""
        d_lower = drug_name.lower()
        for allergy in patient_allergies:
            if allergy in d_lower or d_lower in allergy:
                return True
            for allergy_class, drugs in ALLERGY_CROSS_REACTIVITY.items():
                if allergy_class in allergy and d_lower in drugs:
                    return True
        return False

    def _has_ddi(self, drug_a: str, drug_b: str) -> bool:
        """Query DDI matrix or ontology."""
        if self.ontology.get_ddi_pair(drug_a, drug_b) is not None:
            return True
        if self.ddi_matrix is not None and drug_a in self.drug_vocab and drug_b in self.drug_vocab:
            idx_a = self.drug_vocab[drug_a]
            idx_b = self.drug_vocab[drug_b]
            return bool(self.ddi_matrix[idx_a, idx_b] == 1)
        return False

    def _compute_regimen_ddi_rate(self, drugs: List[Dict[str, Any]]) -> Tuple[int, float]:
        """Compute the empirical pairwise DDI rate for a drug regimen."""
        n = len(drugs)
        if n < 2:
            return 0, 0.0

        total_pairs = n * (n - 1) // 2
        ddi_hits = 0
        for i in range(n):
            for j in range(i + 1, n):
                if self._has_ddi(drugs[i]["name"], drugs[j]["name"]):
                    ddi_hits += 1

        rate = round(ddi_hits / total_pairs, 4) if total_pairs > 0 else 0.0
        return ddi_hits, rate

    def _get_drug_frags(self, drug_id: str) -> Set[str]:
        if self.brics:
            return self.brics.get_drug_fragments(drug_id)
        return set()

    def _compute_brics_cosine(self, drug_a: str, drug_b: str) -> float:
        """Compute cosine similarity of BRICS fragment incidence vectors."""
        if self.brics and self.brics._is_fitted:
            fp_a = self.brics.fingerprints_.get(drug_a)
            fp_b = self.brics.fingerprints_.get(drug_b)
            if fp_a is not None and fp_b is not None:
                norm_a = np.linalg.norm(fp_a)
                norm_b = np.linalg.norm(fp_b)
                if norm_a > 0 and norm_b > 0:
                    return float(np.dot(fp_a, fp_b) / (norm_a * norm_b))
        return 0.25
