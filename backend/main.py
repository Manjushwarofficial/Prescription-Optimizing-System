"""
SafeAudit-CDSS — backend/main.py
==================================
Post-Prescription Molecular Safety Firewall & Alert-Fatigue Triage CDSS.
Grounded in:
  • SafeDrug (IJCAI 2021) — Substructure Graph DDI Dual Encoders & PID Loss
  • GAMENet (AAAI 2019) — Clinical Memory Networks
  • Poly et al. (JMIR 2020) — Machine Learning CPOE Alert-Fatigue Triage
  • FDA TwoSIDES Database — Adverse Event Severity Matrix D in {0, 1}^(MxM)

FastAPI Server Entrypoint.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict

# Ensure backend directory is in sys.path for direct or module-based imports
_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import config
from routers import audit_router, benchmarks_router, molecules_router, patients_router
from routers.audit import get_services as warmup_audit_services

# Configure root logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("safeaudit_api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan event handler: Preload models and chemical indices into memory
    to ensure ultra-low latency (<20ms) CPOE firewall audits.
    """
    logger.info("Initializing SafeAudit-CDSS Backend Server...")
    logger.info("Checking data paths and model checkpoints...")
    try:
        ontology, safedrug, ensemble, optimizer, brics, patient_db = warmup_audit_services()
        logger.info(
            "Warmup successful: %d drugs loaded, BRICS pipeline %s, SafeDrug %s, Ensemble %s",
            len(ontology.formulary) if ontology else 0,
            "READY" if brics else "NOT_FOUND",
            "READY" if (safedrug and safedrug.is_loaded) else "NOT_LOADED",
            "READY" if (ensemble and ensemble.is_fitted) else "NOT_LOADED",
        )
    except Exception as exc:
        logger.error("Warmup warning: %s", exc)

    yield
    logger.info("SafeAudit-CDSS Backend Server shutting down.")


app = FastAPI(
    title="SafeAudit-CDSS: Molecular Substructure & Alert-Fatigue CPOE Firewall",
    description=(
        "Hospital CPOE Post-Prescription Molecular Safety Firewall & Alert-Fatigue Triage Engine. "
        "Grounded in SafeDrug (IJCAI 2021), GAMENet (AAAI 2019), and Poly et al. (JMIR 2020)."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Enable CORS for CPOE Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Sub-Routers
app.include_router(patients_router)
app.include_router(audit_router)
app.include_router(molecules_router)
app.include_router(benchmarks_router)

# Mount Static Assets & Serve Frontend Single Page Application
_STATIC_DIR = _BACKEND_DIR / "static"
_DIST_DIR = _BACKEND_DIR.parent / "frontend" / "dist"

if _DIST_DIR.exists():
    _assets_dir = _DIST_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

if _STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")


@app.get("/", response_class=FileResponse, tags=["Frontend UI"])
def serve_index():
    """Serve the single-page application frontend for CPOE physicians and researchers."""
    if _DIST_DIR.exists() and (_DIST_DIR / "index.html").exists():
        return FileResponse(str(_DIST_DIR / "index.html"))
    if _STATIC_DIR.exists() and (_STATIC_DIR / "index.html").exists():
        return FileResponse(str(_STATIC_DIR / "index.html"))
    return JSONResponse({
        "system": "SafeAudit-CDSS",
        "message": "Frontend index.html not found in static or dist directory.",
        "docs": "/docs"
    })


@app.get("/api", tags=["Health & Status"])
def api_root() -> Dict[str, Any]:
    """Root API entrypoint returning system metadata and API status."""
    return {
        "system": "SafeAudit-CDSS",
        "description": "Molecular Substructure Graph & Alert-Fatigue CPOE Safety Firewall",
        "version": "1.0.0",
        "status": "OPERATIONAL",
        "documentation": "/docs",
        "endpoints": {
            "health": "/api/health",
            "patients": "/api/patients",
            "demo_cases": "/api/patients/demo/cases",
            "formulary": "/api/formulary",
            "audit_prescription": "/api/audit-prescription (POST)",
            "pairwise_ddi": "/api/audit/pair (GET)",
            "molecule_svg": "/api/molecules/{drug_id}/svg",
            "benchmarks": "/api/benchmarks",
        }
    }


@app.get("/api/health", tags=["Health & Status"])
def health_check() -> Dict[str, Any]:
    """Health check endpoint for container orchestrators and frontend connectivity checks."""
    safedrug_ready = config.SAFEDRUG_CHECKPOINT_PATH.exists()
    ensemble_ready = config.ALERT_FATIGUE_CHECKPOINT_PATH.exists()
    eval_metrics_ready = (config.CHECKPOINTS_DIR / "evaluation_metrics.json").exists()
    data_ready = config.FORMULARY_PATH.exists() and config.DDI_MATRIX_PATH.exists()

    status = "HEALTHY" if (safedrug_ready and ensemble_ready and data_ready) else "DEGRADED"

    return {
        "status": status,
        "safedrug_gnn_checkpoint": safedrug_ready,
        "alert_fatigue_checkpoint": ensemble_ready,
        "evaluation_metrics_available": eval_metrics_ready,
        "clinical_data_ready": data_ready,
        "formulary_drugs_count": 74,
        "processed_dir": str(config.PROCESSED_DIR)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=config.API_HOST, port=config.API_PORT, reload=True)
