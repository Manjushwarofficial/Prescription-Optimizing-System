"""
SafeAudit-CDSS — backend/config.py
====================================
Centralised configuration for all backend modules.
Every module imports from here; no magic strings scattered across the codebase.

Grounded in:
  • SafeDrug (IJCAI 2021)   — molecular substructure DDI scoring
  • GAMENet (AAAI 2019)     — graph-augmented memory for polypharmacy safety
  • Poly et al. (JMIR 2020) — alert fatigue taxonomy & confidence calibration
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Root paths
# ---------------------------------------------------------------------------
BACKEND_DIR: Path = Path(__file__).resolve().parent
DATA_DIR: Path = BACKEND_DIR / "data"
RAW_DIR: Path = DATA_DIR / "raw"
PROCESSED_DIR: Path = DATA_DIR / "processed"
CHEMISTRY_DIR: Path = BACKEND_DIR / "chemistry"
CHECKPOINTS_DIR: Path = BACKEND_DIR / "checkpoints"

# Ensure directories exist at import time (safe for all workers)
for _d in (RAW_DIR, PROCESSED_DIR, CHECKPOINTS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Model checkpoint paths
# ---------------------------------------------------------------------------
SAFEDRUG_MODEL_PATH: Path = CHECKPOINTS_DIR / "safedrug_model.pt"
ALERT_FATIGUE_MODEL_PATH: Path = CHECKPOINTS_DIR / "alert_fatigue_ensemble.joblib"
# Aliases
SAFEDRUG_CHECKPOINT_PATH: Path = SAFEDRUG_MODEL_PATH
ALERT_FATIGUE_CHECKPOINT_PATH: Path = ALERT_FATIGUE_MODEL_PATH

# ---------------------------------------------------------------------------
# Clinical dataset file paths (processed outputs)
# ---------------------------------------------------------------------------
FORMULARY_DRUGS_PATH: Path = PROCESSED_DIR / "formulary_drugs.json"
FORMULARY_PATH: Path = FORMULARY_DRUGS_PATH
DDI_MATRIX_PKL_PATH: Path = PROCESSED_DIR / "ddi_matrix.pkl"
DDI_PAIRS_JSON_PATH: Path = PROCESSED_DIR / "ddi_pairs.json"
EHR_PATIENTS_PATH: Path = PROCESSED_DIR / "ehr_patients.json"
DEMO_CASES_PATH: Path = PROCESSED_DIR / "demo_cases.json"
ALERT_FATIGUE_DATASET_PATH: Path = PROCESSED_DIR / "alert_fatigue_dataset.csv"
BRICS_MASK_H_PATH: Path = PROCESSED_DIR / "brics_mask_H.pkl"

# API & Model Hyperparameters
API_HOST: str = "0.0.0.0"
API_PORT: int = 8000
EMBEDDING_DIM: int = 128
MPNN_NUM_LAYERS: int = 3
PID_KP: float = 1.0
PID_KI: float = 0.01
PID_KD: float = 0.1

HISTORICAL_OVERRIDE_RATES = {
    "Neurology": 0.912,
    "Urology": 0.895,
    "Dermatology": 0.941,
    "Cardiology": 0.825,
    "ICU": 0.792,
    "Nephrology": 0.840,
    "Oncology": 0.810,
    "Internal Medicine": 0.865,
    "Emergency": 0.880,
    "Surgery": 0.905
}

# Legacy / Interop paths
DRUG_VOCAB_PATH: Path = PROCESSED_DIR / "drug_vocab.json"
DDI_MATRIX_PATH: Path = PROCESSED_DIR / "ddi_matrix.npy"
DDI_PAIRS_PATH: Path = PROCESSED_DIR / "ddi_pairs.csv"
BRICS_FINGERPRINT_PATH: Path = PROCESSED_DIR / "brics_fingerprints.pkl"
DRUG_SMILES_PATH: Path = PROCESSED_DIR / "drug_smiles.csv"
ONTOLOGY_MAP_PATH: Path = PROCESSED_DIR / "ontology_map.json"

# ---------------------------------------------------------------------------
# BRICS / RDKit chemistry settings
# ---------------------------------------------------------------------------
BRICS_MIN_FRAGMENT_SIZE: int = 1          # minimum heavy atoms in a BRICS fragment
MORGAN_RADIUS: int = 2                     # Morgan fingerprint radius (ECFP4-equivalent)
MORGAN_NBITS: int = 2048                   # bit-vector length for Morgan FP
TANIMOTO_DDI_THRESHOLD: float = 0.75      # Tanimoto similarity → flag potential DDI

# ---------------------------------------------------------------------------
# DDI severity taxonomy  (Poly et al. JMIR 2020 — Table 1 mapping)
# ---------------------------------------------------------------------------
DDI_SEVERITY_LEVELS: dict = {
    0: "No interaction",
    1: "Minor — monitoring advisable",
    2: "Moderate — consider alternative",
    3: "Major — contraindicated",
}

# Confidence calibration (temperature-scaling default; tuned in Phase 3)
CALIBRATION_TEMPERATURE: float = 1.5

# ---------------------------------------------------------------------------
# Alert-fatigue triage thresholds  (Poly et al. JMIR 2020 — §3.2)
# ---------------------------------------------------------------------------
ALERT_OVERRIDE_HIGH_CONFIDENCE: float = 0.90   # auto-suppress low-severity if > 90 % conf
ALERT_PRESENT_THRESHOLD: float = 0.50          # only surface alerts above this raw prob

# ---------------------------------------------------------------------------
# Model / training settings  (Phase 2+)
# ---------------------------------------------------------------------------
MODEL_HIDDEN_DIM: int = 256
MODEL_NUM_LAYERS: int = 3
MODEL_DROPOUT: float = 0.30
TRAIN_EPOCHS: int = 50
TRAIN_BATCH_SIZE: int = 32
TRAIN_LR: float = 1e-3
RANDOM_SEED: int = 42

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOG_LEVEL: str = "INFO"
LOG_FORMAT: str = "%(asctime)s | %(levelname)-8s | %(name)s — %(message)s"
