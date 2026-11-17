"""
SafeAudit-CDSS — backend/routers/patients.py
==============================================
Patient Cohort & Pre-Configured Demo Scenarios Router.
Exposes:
  • GET /api/patients             — Returns 30 longitudinal ICU patients + 4 preset high-risk demo scenarios
  • GET /api/patients/{patient_id} — Full longitudinal patient visit history & tolerated meds
  • GET /api/patients/demo/cases  — 4 Pre-Configured High-Risk Clinical Scenarios for 1-click CPOE test
  • GET /api/patients/demo/cases/{case_id} — Single demo case scenario details
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

import config

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/patients", tags=["Patients & Demo Cases"])


def _load_patients() -> List[Dict[str, Any]]:
    if not config.EHR_PATIENTS_PATH.exists():
        raise HTTPException(status_code=500, detail="Patient dataset ehr_patients.json not found.")
    with open(config.EHR_PATIENTS_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _load_demo_cases() -> List[Dict[str, Any]]:
    if not config.DEMO_CASES_PATH.exists():
        raise HTTPException(status_code=500, detail="Demo cases dataset demo_cases.json not found.")
    with open(config.DEMO_CASES_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


@router.get("", response_model=Dict[str, Any])
def list_patients(limit: int = Query(50, ge=1, le=100)) -> Dict[str, Any]:
    """
    Returns the 30 longitudinal ICU patients modeled on MIMIC-III/IV
    along with the 4 preset high-risk demo scenarios (demo_cases.json).
    """
    patients = _load_patients()
    demo_cases = _load_demo_cases()

    return {
        "patients": patients[:limit],
        "demo_cases": demo_cases,
        "total_patients": len(patients),
        "total_demo_cases": len(demo_cases)
    }


@router.get("/demo/cases", response_model=List[Dict[str, Any]])
def get_all_demo_cases() -> List[Dict[str, Any]]:
    """Return all 4 pre-configured high-risk clinical scenarios for 1-click CPOE testing."""
    return _load_demo_cases()


@router.get("/demo/cases/{case_id}", response_model=Dict[str, Any])
def get_demo_case_by_id(case_id: str) -> Dict[str, Any]:
    """Return single demo case by ID (e.g. CASE-1, CASE-2, CASE-3, CASE-4)."""
    cases = _load_demo_cases()
    for c in cases:
        if c.get("case_id", "").upper() == case_id.upper():
            return c
    raise HTTPException(status_code=404, detail=f"Demo scenario '{case_id}' not found.")


@router.get("/{patient_id}", response_model=Dict[str, Any])
def get_patient_profile(patient_id: str) -> Dict[str, Any]:
    """Retrieve full longitudinal ICU history, diagnoses, procedures, and tolerated medications."""
    patients = _load_patients()
    for p in patients:
        if p.get("patient_id", "").upper() == patient_id.upper():
            tol_meds = set()
            for v in p.get("visits", []):
                for m in v.get("tolerated_meds", []):
                    tol_meds.add(m)
            patient_copy = dict(p)
            patient_copy["tolerated_meds"] = sorted(list(tol_meds))
            return patient_copy
    raise HTTPException(status_code=404, detail=f"Patient '{patient_id}' not found.")
