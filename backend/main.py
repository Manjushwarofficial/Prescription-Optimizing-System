"""
main.py — AI-Based Intelligent Prescription Optimization System
================================================================
FastAPI backend integrating:

1. Trained Ensemble ML Engine  (MLP + Random Forest, sklearn)
   - Multi-label drug recommendation from symptom vectors
   - 0.70 confidence threshold filter

2. TwoSIDES DDI Knowledge Graph (networkx)
   - Covers Lisinopril, Spironolactone, Ibuprofen, Omeprazole,
     Metformin, Atorvastatin, Amlodipine, Amoxicillin
   - Severity levels: High / Moderate / Low

3. PID-Controlled Safety Resolution (SafeDrug paradigm)
   - Iteratively resolves High-severity DDI conflicts
   - Drops the drug with the lowest (confidence - DDI_penalty) net-score

4. Alert Fatigue Filter
   - API only surfaces 'High' severity alerts (silent by default)
   - Compliant with January 2026 FDA CDS Software guidance

5. Evaluation Metrics Endpoint
   - /api/metrics  → Jaccard, PRAUC, Hamming Loss from held-out test set
   - /api/ddi_graph → Graph topology summary

FDA CDS Disclaimer:
  This system is an investigational decision-support tool only.
  It is NOT an autonomous diagnostic agent. All output must be reviewed
  and approved by a licensed physician who retains full clinical judgment.
  Model uncertainty is inherent; never act on this output alone.

References:
  - SafeDrug (Sun et al., IJCAI 2022): external_safedrug/
  - GAMENet (Shang et al., AAAI 2019): external_gamenet/
  - HDN-DDI (jcsun-00/HDN-DDI): external_hdn_ddi/
  - TwoSIDES (Tatonetti et al., 2012): external_twosides/
"""

import os
import sys
import time

# Ensure local packages are importable
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _BACKEND_DIR)
sys.path.insert(0, os.path.join(_BACKEND_DIR, "ml_engine"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any

from ml_engine.dataset_builder import SYMPTOM_IDX, N_SYMPTOMS, DRUG_LIST
from ml_engine.ensemble_model import EnsembleRecommender
from ddi_graph.ddi_knowledge_graph import get_ddi_graph
from ddi_graph.pid_safety_controller import PIDSafetyController

import numpy as np

# ============================================================
# Application setup
# ============================================================

app = FastAPI(
    title="AI-Based Intelligent Prescription Optimization System",
    description=(
        "Ensemble ML + Knowledge Graph DDI safety filter with PID-controlled "
        "resolution. Implements 'silent by default' alert fatigue mitigation. "
        "INVESTIGATIONAL TOOL — requires physician oversight."
    ),
    version="2.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Global model instances (loaded on startup)
# ============================================================

_recommender: EnsembleRecommender | None = None
_ddi_graph = None
_pid_controller: PIDSafetyController | None = None
_startup_metrics: dict = {}


@app.on_event("startup")
async def startup_event():
    global _recommender, _ddi_graph, _pid_controller

    # Load DDI graph (always available — no training needed)
    _ddi_graph = get_ddi_graph()

    # Load trained ensemble (requires prior run of train_models.py)
    _recommender = EnsembleRecommender()
    try:
        _recommender.load()
        _startup_metrics.update({
            "model_status": "trained",
            "eval_metrics": _recommender.eval_metrics,
        })
        print("[Startup] Trained ensemble models loaded successfully.")
    except FileNotFoundError as e:
        print(f"[Startup WARNING] {e}")
        print("[Startup] Falling back to untrained model — run train_models.py first.")
        _startup_metrics.update({
            "model_status": "untrained_fallback",
            "eval_metrics": {},
        })

    # PID safety controller (tuned for fast convergence)
    _pid_controller = PIDSafetyController(
        target_ddi_rate=0.0,
        kp=0.8,
        ki=0.1,
        kd=0.05,
        max_iterations=20,
    )


# ============================================================
# Request / Response schemas
# ============================================================

class PatientRequest(BaseModel):
    symptoms: List[str] = Field(
        ...,
        example=["hypertension", "heart_failure", "edema"],
        description=(
            "List of patient symptom keywords. Valid values include: "
            "hypertension, heart_failure, edema, pain, inflammation, fever, "
            "acid_reflux, peptic_ulcer, type2_diabetes, hyperlipidemia, "
            "angina, bacterial_infection, pneumonia, renal_impairment"
        ),
    )
    confidence_threshold: float = Field(
        default=0.70,
        ge=0.0,
        le=1.0,
        description="Minimum ensemble confidence to include a drug in the proposal.",
    )


class InterventionEvent(BaseModel):
    drug_a: str
    drug_b: str
    severity: str
    side_effect: str
    mechanism: str
    frequency: float
    source: str
    action_taken: str
    pid_iteration: int
    pid_error: float
    pid_output: float


class OptimizationResponse(BaseModel):
    safe_prescription: Dict[str, float]
    system_interventions: List[InterventionEvent]
    all_proposals: Dict[str, float]
    ddi_rate_before: float
    ddi_rate_after: float
    model_status: str
    eval_metrics: Dict[str, Any]
    alert_fatigue_note: str
    fda_disclaimer: str
    processing_time_ms: float


# ============================================================
# Core optimization endpoint
# ============================================================

@app.post("/api/optimize_prescription", response_model=OptimizationResponse)
def optimize_prescription(request: PatientRequest):
    """
    Main prescription optimization endpoint.

    Pipeline:
    1. Encode symptoms → feature vector
    2. Ensemble inference → per-drug probabilities
    3. Threshold filter (default 0.70)
    4. DDI Knowledge Graph check (TwoSIDES-based)
    5. PID-controlled conflict resolution (SafeDrug paradigm)
    6. Alert fatigue filter (only 'High' severity surfaced)
    7. Return safe prescription + blocked interventions
    """
    t0 = time.perf_counter()

    if _recommender is None or _ddi_graph is None or _pid_controller is None:
        raise HTTPException(status_code=503, detail="Models not initialised.")

    # ------------------------------------------------------------------
    # Step 1: Encode symptoms to feature vector
    # ------------------------------------------------------------------
    x = np.zeros((1, N_SYMPTOMS), dtype=np.float32)
    recognised = []
    for sym in request.symptoms:
        key = sym.lower().replace(" ", "_").replace("-", "_")
        if key in SYMPTOM_IDX:
            x[0, SYMPTOM_IDX[key]] = 1.0
            recognised.append(key)

    # ------------------------------------------------------------------
    # Step 2: Ensemble inference
    # ------------------------------------------------------------------
    if _startup_metrics.get("model_status") == "trained":
        proba_arr = _recommender.predict_proba(x)[0]  # shape (n_drugs,)
        all_proba = {drug: float(proba_arr[i]) for i, drug in enumerate(DRUG_LIST)}
    else:
        # Fallback: symptom-based deterministic heuristic (for demo without training)
        all_proba = _fallback_heuristic(recognised)

    # ------------------------------------------------------------------
    # Step 3: Threshold filter
    # ------------------------------------------------------------------
    proposed = {
        drug: conf
        for drug, conf in all_proba.items()
        if conf >= request.confidence_threshold
    }

    # DDI rate before resolution
    ddi_rate_before = _ddi_graph.compute_ddi_rate(list(proposed.keys()))

    # ------------------------------------------------------------------
    # Step 4 & 5: DDI check + PID resolution
    # ------------------------------------------------------------------
    # Fetch ALL interactions first (for rate computation)
    all_interactions = _ddi_graph.get_interactions(list(proposed.keys()))

    # Alert fatigue: only feed 'High' severity to PID controller
    high_interactions = [i for i in all_interactions if i["severity"] == "High"]

    safe_drugs, blocked_events = _pid_controller.resolve(proposed, high_interactions)

    # DDI rate after resolution
    ddi_rate_after = _ddi_graph.compute_ddi_rate(list(safe_drugs.keys()))

    # ------------------------------------------------------------------
    # Step 6: Build response
    # ------------------------------------------------------------------
    t_ms = (time.perf_counter() - t0) * 1000

    return OptimizationResponse(
        safe_prescription=safe_drugs,
        system_interventions=blocked_events,
        all_proposals=proposed,
        ddi_rate_before=round(ddi_rate_before, 4),
        ddi_rate_after=round(ddi_rate_after, 4),
        model_status=_startup_metrics.get("model_status", "unknown"),
        eval_metrics=_startup_metrics.get("eval_metrics", {}),
        alert_fatigue_note=(
            "Moderate- and Low-severity DDI alerts are suppressed by default "
            "to mitigate alert fatigue (physicians override 85-95% of automated alerts). "
            "Only High-severity interactions trigger active blocking."
        ),
        fda_disclaimer=(
            "FDA CDS Software Guidance (January 2026): This output is an "
            "investigational decision-support recommendation only. It is NOT "
            "an autonomous diagnostic or prescribing agent. The attending physician "
            "must independently review all suggestions and exercise clinical judgment. "
            "Model uncertainty is inherent in all probabilistic outputs."
        ),
        processing_time_ms=round(t_ms, 2),
    )


# ============================================================
# Auxiliary endpoints
# ============================================================

@app.get("/api/metrics")
def get_metrics():
    """Return held-out evaluation metrics for the trained ensemble."""
    return {
        "model_status": _startup_metrics.get("model_status", "unknown"),
        "metrics": _startup_metrics.get("eval_metrics", {}),
        "description": {
            "jaccard": "Average per-visit Jaccard similarity between predicted and ground-truth drug sets",
            "prauc": "Macro-averaged Precision-Recall AUC across all drugs",
            "hamming_loss": "Fraction of incorrectly predicted drug labels (lower is better)",
        },
    }


@app.get("/api/ddi_graph")
def get_graph_summary():
    """Return DDI Knowledge Graph topology summary."""
    if _ddi_graph is None:
        raise HTTPException(status_code=503, detail="DDI graph not initialised.")
    return {
        "graph_summary": _ddi_graph.get_graph_summary(),
        "formulary": DRUG_LIST,
        "data_source": "TwoSIDES (Tatonetti et al., 2012) + FDA labels + Clinical guidelines",
        "reference_repo": "https://github.com/jcsun-00/Twosides",
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_status": _startup_metrics.get("model_status", "not_loaded"),
        "ddi_graph_loaded": _ddi_graph is not None,
    }


# ============================================================
# Fallback heuristic (when models not yet trained)
# ============================================================

def _fallback_heuristic(recognised_symptoms: List[str]) -> Dict[str, float]:
    """
    Simple symptom-to-drug mapping used only when trained models
    are not available. Clearly labelled in the API response.
    """
    scores = {drug: 0.3 for drug in DRUG_LIST}
    rules = {
        "hypertension":       {"Lisinopril": 0.87, "Amlodipine": 0.75},
        "heart_failure":      {"Spironolactone": 0.81, "Lisinopril": 0.84},
        "edema":              {"Spironolactone": 0.76},
        "pain":               {"Ibuprofen": 0.82},
        "inflammation":       {"Ibuprofen": 0.80},
        "fever":              {"Ibuprofen": 0.72},
        "acid_reflux":        {"Omeprazole": 0.90},
        "peptic_ulcer":       {"Omeprazole": 0.92},
        "type2_diabetes":     {"Metformin": 0.89},
        "hyperlipidemia":     {"Atorvastatin": 0.91},
        "angina":             {"Amlodipine": 0.86},
        "bacterial_infection":{"Amoxicillin": 0.87},
        "pneumonia":          {"Amoxicillin": 0.85},
    }
    for sym in recognised_symptoms:
        if sym in rules:
            for drug, score in rules[sym].items():
                scores[drug] = max(scores[drug], score)
    return scores
