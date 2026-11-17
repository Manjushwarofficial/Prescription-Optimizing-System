"""
SafeAudit-CDSS — backend/routers/audit.py
===========================================
Core CPOE Post-Prescription Safety Firewall & Alert-Fatigue Triage Router.
Grounded in:
  • SafeDrug (IJCAI 2021) — Substructure Graph DDI Dual Encoders & PID Controller
  • GAMENet (AAAI 2019) — Clinical Memory Architecture
  • Poly et al. (JMIR 2020) — Machine Learning Alert-Fatigue Overrides (Table 1)
  • TwoSIDES Database — FDA Adverse Event DDI Severity Matrix D in {0, 1}^(MxM)

Exposes:
  • POST /api/audit-prescription — Core CPOE prescription audit, alert triage & 1-click safe replacements
  • POST /api/audit              — Alias for /api/audit-prescription
  • GET  /api/audit/pair         — Direct pairwise molecular DDI inspection & clash analysis
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import config
from chemistry.ontology_mapper import OntologyMapper
from chemistry.rdkit_brics import BRICSPipeline
from models.alert_fatigue_ensemble import AlertFatigueEnsemble
from models.safedrug_gnn import SafeDrugPipeline
from models.substitute_optimizer import SubstituteOptimizer

logger = logging.getLogger(__name__)
router = APIRouter(tags=["CPOE Safety Firewall"])

# Global singletons
_ONTOLOGY: Optional[OntologyMapper] = None
_SAFEDRUG: Optional[SafeDrugPipeline] = None
_ENSEMBLE: Optional[AlertFatigueEnsemble] = None
_OPTIMIZER: Optional[SubstituteOptimizer] = None
_BRICS: Optional[BRICSPipeline] = None
_PATIENT_DB: Optional[Dict[str, Dict[str, Any]]] = None


def get_services():
    """Lazily load and cache all core AI and chemistry pipelines."""
    global _ONTOLOGY, _SAFEDRUG, _ENSEMBLE, _OPTIMIZER, _BRICS, _PATIENT_DB

    if _ONTOLOGY is None:
        _ONTOLOGY = OntologyMapper()

    if _BRICS is None and config.BRICS_FINGERPRINT_PATH.exists():
        try:
            _BRICS = BRICSPipeline.load(config.PROCESSED_DIR)
        except Exception as e:
            logger.warning("Could not load BRICSPipeline: %s", e)

    if _SAFEDRUG is None:
        _SAFEDRUG = SafeDrugPipeline()
        if config.SAFEDRUG_CHECKPOINT_PATH.exists():
            try:
                _SAFEDRUG.load(config.SAFEDRUG_CHECKPOINT_PATH)
            except Exception as e:
                logger.warning("Could not load SafeDrug checkpoint: %s", e)

    if _ENSEMBLE is None:
        if config.ALERT_FATIGUE_CHECKPOINT_PATH.exists():
            try:
                _ENSEMBLE = AlertFatigueEnsemble.load(config.ALERT_FATIGUE_CHECKPOINT_PATH)
            except Exception as e:
                logger.warning("Could not load AlertFatigue checkpoint: %s", e)

    if _OPTIMIZER is None:
        _OPTIMIZER = SubstituteOptimizer(ontology_mapper=_ONTOLOGY, brics_pipeline=_BRICS)

    if _PATIENT_DB is None and config.EHR_PATIENTS_PATH.exists():
        with open(config.EHR_PATIENTS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
            _PATIENT_DB = {p["patient_id"]: p for p in data}

    return _ONTOLOGY, _SAFEDRUG, _ENSEMBLE, _OPTIMIZER, _BRICS, _PATIENT_DB


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------

class AuditPrescriptionRequest(BaseModel):
    patient_id: Optional[str] = Field(None, description="Patient ID for longitudinal EHR lookup (e.g. PT-1001)")
    drug_ids: Optional[List[str]] = Field(None, description="List of drug IDs or names in draft order")
    prescribed_drugs: Optional[List[str]] = Field(None, description="Alias for drug_ids")
    department_id: Optional[str] = Field("Cardiology", description="Hospital Department")
    physician_id: Optional[str] = Field("DR_ICU_042", description="Ordering Physician ID")
    pid_gamma: Optional[float] = Field(0.06, description="SafeDrug target DDI threshold gamma in [0.01, 0.08]")
    allergies: Optional[List[str]] = Field(default_factory=list, description="Patient documented allergies")
    diagnoses: Optional[List[str]] = Field(default_factory=list, description="Patient ICD-10 diagnosis codes")
    include_substitutes: bool = Field(True, description="Whether to include safe within-class substitutes")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/api/audit-prescription", response_model=Dict[str, Any])
@router.post("/api/audit", response_model=Dict[str, Any])
def audit_prescription(req: AuditPrescriptionRequest) -> Dict[str, Any]:
    """
    Core CPOE Post-Prescription Safety Firewall Audit.
    Evaluates:
      1. TwoSIDES Clinical DDI Adjacency Matrix D in {0, 1}^(MxM)
      2. SafeDrug Dual GNN Molecular Interaction Probabilities P(DDI)
      3. Poly et al. Alert-Fatigue Actionability Triage (HARD_STOP | PASSIVE_INLINE | SUPPRESSED_SPAM)
      4. SafeDrug Within-Class Zero-DDI 1-Click Substitute Recommendations
    """
    start_time = time.perf_counter()
    ontology, safedrug, ensemble, optimizer, brics, patient_db = get_services()

    # Determine input drug identifiers (supports drug_ids or prescribed_drugs)
    raw_drugs = req.drug_ids or req.prescribed_drugs
    if not raw_drugs:
        raise HTTPException(
            status_code=400,
            detail="Must provide medication list via 'drug_ids' or 'prescribed_drugs'."
        )

    # 1. Resolve Prescribed Drugs
    resolved_drugs: List[Dict[str, Any]] = []
    unrecognized: List[str] = []

    for d in raw_drugs:
        drug_rec = ontology.resolve(d)
        if drug_rec:
            if not any(r["drug_id"] == drug_rec["drug_id"] for r in resolved_drugs):
                resolved_drugs.append(drug_rec)
        else:
            unrecognized.append(d)

    if not resolved_drugs:
        raise HTTPException(
            status_code=400,
            detail=f"None of the provided medications could be resolved in the ICU formulary: {raw_drugs}"
        )

    # 2. Extract Patient Context (Longitudinal EHR)
    patient_info = None
    tolerated_drugs: List[str] = []
    patient_age = 65
    patient_gender = "M"
    primary_icd10 = "I25.1"

    if req.patient_id and patient_db and req.patient_id in patient_db:
        patient_info = patient_db[req.patient_id]
        patient_age = patient_info.get("age", 65)
        patient_gender = patient_info.get("gender", "M")

        tol_set = set(patient_info.get("tolerated_meds", []))
        for v in patient_info.get("visits", []):
            for m in v.get("tolerated_meds", []):
                tol_set.add(m)
                rec = ontology.resolve(m)
                if rec:
                    tol_set.add(rec["name"])
                    tol_set.add(rec["drug_id"])
        tolerated_drugs = list(tol_set)

        if patient_info.get("visits") and patient_info["visits"][-1].get("icd10_diagnoses"):
            primary_icd10 = patient_info["visits"][-1]["icd10_diagnoses"][0].get("code", "I25.1")
    elif req.diagnoses and len(req.diagnoses) > 0:
        primary_icd10 = req.diagnoses[0]

    dept_id = req.department_id or "Cardiology"
    dept_override_rate = config.HISTORICAL_OVERRIDE_RATES.get(dept_id, 0.880)

    # 3. Pairwise DDI Analysis & Alert Fatigue Triage
    n_drugs = len(resolved_drugs)
    alerts_list: List[Dict[str, Any]] = []
    ddi_alerts_compat: List[Dict[str, Any]] = []
    safe_substitutes_list: List[Dict[str, Any]] = []
    all_pairs_analyzed = 0

    hard_stop_count = 0
    passive_warnings_count = 0
    suppressed_spam_count = 0

    allergies_list = (patient_info.get("allergies", []) if patient_info else []) + (req.allergies or [])

    for i in range(n_drugs):
        for j in range(i + 1, n_drugs):
            all_pairs_analyzed += 1
            drug_a = resolved_drugs[i]
            drug_b = resolved_drugs[j]

            # Check TwoSIDES Adjacency Matrix
            known_ddi = ontology.get_ddi_pair(drug_a["name"], drug_b["name"])
            has_twosides_clash = (known_ddi is not None)

            # Check SafeDrug Dual GNN interaction probability
            gnn_res = {"ddi_probability": 0.05, "risk_tier": "Low/Safe"}
            if safedrug and safedrug.is_loaded:
                gnn_res = safedrug.predict_ddi_pair(drug_a["name"], drug_b["name"])

            gnn_prob = gnn_res.get("ddi_probability", 0.0)
            is_active_ddi = has_twosides_clash or (gnn_prob >= 0.45)

            if not is_active_ddi:
                continue

            # Clinical Severity & Mechanisms
            if has_twosides_clash:
                severity = known_ddi.get("severity_tier", "Major")
                side_effect = known_ddi.get("twosides_side_effect", "Adverse Pharmacological Clash")
                mechanism = known_ddi.get("mechanism", "Pharmacokinetic / Pharmacodynamic clash")
            else:
                severity = gnn_res.get("risk_tier", "Moderate")
                side_effect = "Predicted Molecular Graph Clash (SafeDrug Dual GNN)"
                mechanism = f"SafeDrug MPNN Substructure embedding clash score: {gnn_prob:.3f}"

            severity_score = {"Critical": 3, "Major": 2, "Moderate": 1}.get(severity, 2)
            prior_tolerance = (drug_a["name"] in tolerated_drugs or drug_b["name"] in tolerated_drugs or
                              drug_a["drug_id"] in tolerated_drugs or drug_b["drug_id"] in tolerated_drugs)

            # Shared BRICS Chemical Substructures
            shared_substructures = []
            brics_cosine_sim = 0.0
            if brics:
                a_frags = brics.get_drug_fragments(drug_a["drug_id"])
                b_frags = brics.get_drug_fragments(drug_b["drug_id"])
                shared_substructures = list(a_frags.intersection(b_frags))

                fp_a = brics.fingerprints_.get(drug_a["name"])
                fp_b = brics.fingerprints_.get(drug_b["name"])
                if fp_a is not None and fp_b is not None:
                    na = np.linalg.norm(fp_a)
                    nb = np.linalg.norm(fp_b)
                    if na > 0 and nb > 0:
                        brics_cosine_sim = float(np.dot(fp_a, fp_b) / (na * nb))

            # Alert-Fatigue Dynamic Confidence-Weighted Classification
            triage_tier = "PASSIVE_INLINE_WARNING"
            acceptance_prob = 0.50
            override_prob = 0.50
            epistemic_unc = 0.20
            triage_action = "Display Amber Inline Badge"
            triage_rationale = ""

            if ensemble and ensemble.is_fitted:
                alert_record = {
                    "patient_age": patient_age,
                    "patient_gender": patient_gender,
                    "icd10_3digit": primary_icd10[:3] if primary_icd10 else "I25",
                    "atc_5digit": drug_a.get("atc4_code", "B01AC")[:5],
                    "department_id": dept_id,
                    "prior_patient_tolerance": 1 if prior_tolerance else 0,
                    "dept_historical_override_rate": dept_override_rate,
                    "ddi_severity_score": severity_score,
                    "shared_brics_count": len(shared_substructures),
                }
                pred_triage = ensemble.predict_triage(alert_record, severity_tier=severity)
                triage_tier = pred_triage["triage_tier"]
                acceptance_prob = pred_triage.get("acceptance_probability", 0.5)
                override_prob = pred_triage.get("override_probability", 0.5)
                epistemic_unc = pred_triage.get("epistemic_uncertainty", 0.15)
                triage_action = pred_triage.get("recommended_action", "Review Alert")
                triage_rationale = pred_triage.get("clinical_explanation", "")
            else:
                if severity == "Critical":
                    triage_tier = "HARD_STOP_CRITICAL"
                    triage_action = "TRIGGER_INTERRUPTIVE_MODAL"
                elif prior_tolerance and severity != "Critical":
                    triage_tier = "SUPPRESSED_SPAM"
                    triage_action = "SILENT_AUDIT_LOG"
                else:
                    triage_tier = "PASSIVE_INLINE_WARNING"
                    triage_action = "AMBER_INLINE_BADGE"

            # Tally
            if triage_tier == "HARD_STOP_CRITICAL":
                hard_stop_count += 1
            elif triage_tier == "PASSIVE_INLINE_WARNING":
                passive_warnings_count += 1
            elif triage_tier == "SUPPRESSED_SPAM":
                suppressed_spam_count += 1

            # Format primary alert structure
            alert_entry = {
                "alert_id": f"ALT_{drug_a['drug_id']}_{drug_b['drug_id']}",
                "drug_a": drug_a["name"],
                "drug_b": drug_b["name"],
                "drug_a_id": drug_a["drug_id"],
                "drug_b_id": drug_b["drug_id"],
                "twosides_effect": side_effect,
                "mechanism": mechanism,
                "severity": severity,
                "alert_tier": triage_tier,
                "override_probability": round(override_prob, 4),
                "acceptance_probability": round(acceptance_prob, 4),
                "epistemic_uncertainty": round(epistemic_unc, 4),
                "brics_cosine_sim": round(brics_cosine_sim, 3),
                "shared_substructures": shared_substructures,
                "svg_url": f"/api/molecules/{drug_a['drug_id']}/svg?compare_with={drug_b['drug_id']}"
            }
            alerts_list.append(alert_entry)

            # Compute Safe Substitutes for clashing pair
            substitutes_a = []
            substitutes_b = []
            if req.include_substitutes and optimizer:
                other_meds_for_a = [d["name"] for d in resolved_drugs if d["drug_id"] != drug_a["drug_id"]]
                other_meds_for_b = [d["name"] for d in resolved_drugs if d["drug_id"] != drug_b["drug_id"]]
                substitutes_a = optimizer.optimize_substitute(drug_a["name"], other_meds_for_a, patient_allergies=allergies_list, top_k=2)
                substitutes_b = optimizer.optimize_substitute(drug_b["name"], other_meds_for_b, patient_allergies=allergies_list, top_k=2)

                # Add 1-click replacement recommendations
                for s in substitutes_a:
                    safe_substitutes_list.append({
                        "replace_drug_id": drug_a["drug_id"],
                        "replace_drug_name": drug_a["name"],
                        "substitute_drug_id": s["candidate_id"],
                        "substitute_name": s["candidate_name"],
                        "atc_class": s["atc_class_name"],
                        "new_set_ddi_rate": s["post_swap_ddi_rate"],
                        "reason": s["clinical_rationale"]
                    })
                for s in substitutes_b:
                    safe_substitutes_list.append({
                        "replace_drug_id": drug_b["drug_id"],
                        "replace_drug_name": drug_b["name"],
                        "substitute_drug_id": s["candidate_id"],
                        "substitute_name": s["candidate_name"],
                        "atc_class": s["atc_class_name"],
                        "new_set_ddi_rate": s["post_swap_ddi_rate"],
                        "reason": s["clinical_rationale"]
                    })

            # Backward-compatible enriched alert entry for earlier test harnesses
            ddi_alerts_compat.append({
                "alert_id": alert_entry["alert_id"],
                "drug_a": {
                    "drug_id": drug_a["drug_id"],
                    "name": drug_a["name"],
                    "atc3": drug_a.get("atc3_code"),
                    "atc_class": drug_a.get("atc_class_name"),
                    "smiles": drug_a.get("smiles"),
                    "svg_url": f"/api/molecules/{drug_a['drug_id']}/svg?compare_with={drug_b['drug_id']}",
                },
                "drug_b": {
                    "drug_id": drug_b["drug_id"],
                    "name": drug_b["name"],
                    "atc3": drug_b.get("atc3_code"),
                    "atc_class": drug_b.get("atc_class_name"),
                    "smiles": drug_b.get("smiles"),
                    "svg_url": f"/api/molecules/{drug_b['drug_id']}/svg?compare_with={drug_a['drug_id']}",
                },
                "severity_tier": severity,
                "twosides_adverse_effect": side_effect,
                "mechanism_description": mechanism,
                "gnn_predicted_ddi_prob": round(gnn_prob, 4),
                "shared_brics_count": len(shared_substructures),
                "prior_patient_tolerance": prior_tolerance,
                "triage_decision": {
                    "tier": triage_tier,
                    "action": triage_action,
                    "acceptance_probability": acceptance_prob,
                    "override_probability": override_prob,
                    "rationale": triage_rationale,
                },
                "safe_substitutes": {
                    "for_drug_a": substitutes_a,
                    "for_drug_b": substitutes_b,
                }
            })

    elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)
    raw_alerts_count = len(alerts_list)
    set_ddi_rate = round(raw_alerts_count / all_pairs_analyzed, 4) if all_pairs_analyzed > 0 else 0.0
    mitigation_rate = round((suppressed_spam_count / raw_alerts_count) * 100, 1) if raw_alerts_count > 0 else 0.0

    if hard_stop_count > 0:
        safety_status = "CRITICAL_INTERCEPT_BLOCKED"
        status_message = f"CRITICAL SAFETY INTERCEPT: {hard_stop_count} life-threatening drug interaction(s) detected. Immediate physician review required."
    elif passive_warnings_count > 0:
        safety_status = "HIGH_PRIORITY_WARNING"
        status_message = f"High-priority drug-drug interaction(s) detected ({passive_warnings_count}). Clinical review strongly recommended."
    elif suppressed_spam_count > 0 and (hard_stop_count + passive_warnings_count) == 0:
        safety_status = "CLEARED_ALERTS_SUPPRESSED"
        status_message = f"Prescription safe. {suppressed_spam_count} habitual/well-tolerated alert(s) silently suppressed to eliminate alert fatigue."
    else:
        safety_status = "PRESCRIPTION_CLEARED_SAFE"
        status_message = "Prescription verified safe. Zero molecular substructure clashes or TwoSIDES adverse DDIs detected."

    # Remove duplicate replacement recommendations
    unique_substitutes = []
    seen_subs = set()
    for s in safe_substitutes_list:
        key = (s["replace_drug_id"], s["substitute_drug_id"])
        if key not in seen_subs:
            seen_subs.add(key)
            unique_substitutes.append(s)

    return {
        "summary": {
            "total_drugs": n_drugs,
            "total_pairs_checked": all_pairs_analyzed,
            "raw_rule_alerts_count": raw_alerts_count,
            "suppressed_spam_count": suppressed_spam_count,
            "alert_fatigue_reduction_pct": mitigation_rate,
            "passive_warnings_count": passive_warnings_count,
            "hard_stop_count": hard_stop_count,
            "set_ddi_rate": set_ddi_rate,
            "safety_status": safety_status,
        },
        "alerts": alerts_list,
        "safe_substitutes": unique_substitutes,
        # Backward compatibility properties
        "status": safety_status,
        "message": status_message,
        "execution_latency_ms": elapsed_ms,
        "audit_summary": {
            "total_medications_prescribed": n_drugs,
            "resolved_formulary_drugs": n_drugs,
            "unrecognized_drugs": unrecognized,
            "total_pairs_evaluated": all_pairs_analyzed,
            "total_ddi_alerts_found": raw_alerts_count,
            "triage_breakdown": {
                "hard_stop_critical": hard_stop_count,
                "passive_inline_warnings": passive_warnings_count,
                "suppressed_spam": suppressed_spam_count,
            },
            "alert_fatigue_reduction_pct": f"{mitigation_rate}%",
        },
        "patient_context": {
            "patient_id": req.patient_id,
            "age": patient_age,
            "gender": patient_gender,
            "department": dept_id,
            "primary_icd10": primary_icd10,
            "tolerated_medications_count": len(tolerated_drugs),
        },
        "prescribed_medications": resolved_drugs,
        "ddi_alerts": ddi_alerts_compat,
    }


@router.get("/api/audit/pair", response_model=Dict[str, Any])
def inspect_ddi_pair(
    drug_a: str = Query(..., description="First drug name or drug_id (e.g. Clopidogrel)"),
    drug_b: str = Query(..., description="Second drug name or drug_id (e.g. Omeprazole)"),
) -> Dict[str, Any]:
    """
    Direct pairwise molecular interaction lookup & clash analysis for 2 drugs.
    """
    ontology, safedrug, _, optimizer, brics, _ = get_services()

    rec_a = ontology.resolve(drug_a)
    rec_b = ontology.resolve(drug_b)

    if not rec_a:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_a}' not found in ICU formulary.")
    if not rec_b:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_b}' not found in ICU formulary.")

    known_ddi = ontology.get_ddi_pair(rec_a["name"], rec_b["name"])
    gnn_res = {"ddi_probability": 0.05, "risk_tier": "Low/Safe"}
    if safedrug and safedrug.is_loaded:
        gnn_res = safedrug.predict_ddi_pair(rec_a["name"], rec_b["name"])

    shared_brics = []
    if brics:
        frags_a = brics.get_drug_fragments(rec_a["drug_id"])
        frags_b = brics.get_drug_fragments(rec_b["drug_id"])
        shared_brics = list(frags_a.intersection(frags_b))

    substitutes_a = []
    substitutes_b = []
    if optimizer and known_ddi:
        substitutes_a = optimizer.optimize_substitute(rec_a["name"], [rec_b["name"]], top_k=2)
        substitutes_b = optimizer.optimize_substitute(rec_b["name"], [rec_a["name"]], top_k=2)

    return {
        "drug_a": rec_a,
        "drug_b": rec_b,
        "is_known_twosides_ddi": (known_ddi is not None),
        "twosides_data": known_ddi,
        "safedrug_gnn_prediction": gnn_res,
        "shared_brics_substructures": shared_brics,
        "shared_brics_count": len(shared_brics),
        "visual_clash_svg_url": f"/api/molecules/{rec_a['drug_id']}/svg?compare_with={rec_b['drug_id']}",
        "recommended_substitutes": {
            f"substitutes_for_{rec_a['name']}": substitutes_a,
            f"substitutes_for_{rec_b['name']}": substitutes_b,
        }
    }
