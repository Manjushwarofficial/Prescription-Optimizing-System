"""
dataset_builder.py
==================
Synthesizes a clinical dataset for training the prescription optimization models.

Design rationale:
- Inspired by MIMIC-IV EHR structure: symptoms (ICD-10 proxies) → medications
- 15,000 patient encounters across 8 common chronic/acute conditions
- Multi-label: a patient can have multiple diagnoses → multiple drugs
- Symptom features are one-hot encoded ICD-10-like codes
- Ground-truth medication sets reflect real clinical guidelines

Drug-symptom mapping is modeled after:
  - Lisinopril    → Hypertension, Heart Failure, Diabetic nephropathy
  - Spironolactone→ Heart Failure, Hypertension (resistant), Edema
  - Ibuprofen     → Pain, Inflammation, Fever
  - Omeprazole    → GERD, Peptic Ulcer, NSAID-induced gastropathy
  - Metformin     → Type 2 Diabetes
  - Atorvastatin  → Hyperlipidemia, Cardiovascular risk
  - Amlodipine    → Hypertension, Angina
  - Amoxicillin   → Bacterial Infection, Pneumonia

DDI pairs (from TwoSIDES / clinical guidelines):
  - Lisinopril + Spironolactone → Hyperkalemia (SEVERE)
  - Ibuprofen + Lisinopril     → Reduced antihypertensive effect (MODERATE)
  - Ibuprofen + Spironolactone → Reduced diuretic effect (MODERATE)
  - Metformin + Ibuprofen      → Renal impairment risk (MODERATE)
"""

import numpy as np
import pandas as pd
from typing import List, Dict, Tuple

# ------------------------------------------------------------------
# Formulary (must match ddi_knowledge_graph.py exactly)
# ------------------------------------------------------------------
DRUG_LIST = [
    "Lisinopril",
    "Spironolactone",
    "Ibuprofen",
    "Omeprazole",
    "Metformin",
    "Atorvastatin",
    "Amlodipine",
    "Amoxicillin",
]
DRUG_IDX = {d: i for i, d in enumerate(DRUG_LIST)}

# ------------------------------------------------------------------
# Symptom vocabulary (ICD-10-inspired feature space)
# ------------------------------------------------------------------
SYMPTOM_LIST = [
    "hypertension",
    "heart_failure",
    "edema",
    "pain",
    "inflammation",
    "fever",
    "acid_reflux",
    "peptic_ulcer",
    "type2_diabetes",
    "hyperlipidemia",
    "angina",
    "bacterial_infection",
    "pneumonia",
    "renal_impairment",
]
SYMPTOM_IDX = {s: i for i, s in enumerate(SYMPTOM_LIST)}
N_SYMPTOMS = len(SYMPTOM_LIST)
N_DRUGS = len(DRUG_LIST)

# ------------------------------------------------------------------
# Clinical rule templates  [symptoms] -> {drug: base_probability}
# ------------------------------------------------------------------
CLINICAL_RULES: List[Dict] = [
    {
        "name": "Essential Hypertension",
        "symptoms": ["hypertension"],
        "drugs": {"Lisinopril": 0.92, "Amlodipine": 0.80, "Spironolactone": 0.45},
        "weight": 0.18,
    },
    {
        "name": "Heart Failure + Hypertension",
        "symptoms": ["hypertension", "heart_failure", "edema"],
        "drugs": {"Lisinopril": 0.88, "Spironolactone": 0.82, "Amlodipine": 0.50},
        "weight": 0.12,
    },
    {
        "name": "Musculoskeletal Pain",
        "symptoms": ["pain", "inflammation"],
        "drugs": {"Ibuprofen": 0.85, "Omeprazole": 0.70},
        "weight": 0.14,
    },
    {
        "name": "GERD / Acid Reflux",
        "symptoms": ["acid_reflux"],
        "drugs": {"Omeprazole": 0.91},
        "weight": 0.10,
    },
    {
        "name": "Peptic Ulcer Disease",
        "symptoms": ["peptic_ulcer", "acid_reflux"],
        "drugs": {"Omeprazole": 0.95, "Amoxicillin": 0.60},
        "weight": 0.08,
    },
    {
        "name": "Type 2 Diabetes",
        "symptoms": ["type2_diabetes"],
        "drugs": {"Metformin": 0.90, "Atorvastatin": 0.55},
        "weight": 0.12,
    },
    {
        "name": "Hyperlipidemia",
        "symptoms": ["hyperlipidemia"],
        "drugs": {"Atorvastatin": 0.92},
        "weight": 0.10,
    },
    {
        "name": "Stable Angina",
        "symptoms": ["angina", "hypertension"],
        "drugs": {"Amlodipine": 0.88, "Atorvastatin": 0.75, "Lisinopril": 0.55},
        "weight": 0.08,
    },
    {
        "name": "Bacterial Pneumonia",
        "symptoms": ["bacterial_infection", "pneumonia", "fever"],
        "drugs": {"Amoxicillin": 0.88},
        "weight": 0.08,
    },
]


def _normalize_weights(rules: List[Dict]) -> np.ndarray:
    w = np.array([r["weight"] for r in rules], dtype=float)
    return w / w.sum()


def build_dataset(
    n_samples: int = 15_000,
    noise_level: float = 0.05,
    random_seed: int = 42,
) -> Tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    """
    Returns
    -------
    X : np.ndarray, shape (n_samples, N_SYMPTOMS)   - binary symptom features
    y : np.ndarray, shape (n_samples, N_DRUGS)       - binary multi-label targets
    df: pd.DataFrame                                  - human-readable version
    """
    rng = np.random.default_rng(random_seed)
    weights = _normalize_weights(CLINICAL_RULES)

    X = np.zeros((n_samples, N_SYMPTOMS), dtype=np.float32)
    y = np.zeros((n_samples, N_DRUGS), dtype=np.float32)

    rule_choices = rng.choice(len(CLINICAL_RULES), size=n_samples, p=weights)

    for i, rule_idx in enumerate(rule_choices):
        rule = CLINICAL_RULES[rule_idx]

        # -- Symptom features: activate rule symptoms + small random noise --
        for s in rule["symptoms"]:
            X[i, SYMPTOM_IDX[s]] = 1.0
        # Add noisy co-occurring symptoms
        noise_syms = rng.random(N_SYMPTOMS) < noise_level
        X[i] = np.clip(X[i] + noise_syms.astype(float), 0, 1)

        # -- Drug labels: sample from Bernoulli with rule probabilities --
        for drug, prob in rule["drugs"].items():
            jittered_prob = np.clip(prob + rng.normal(0, 0.03), 0.0, 1.0)
            y[i, DRUG_IDX[drug]] = float(rng.random() < jittered_prob)

    # Ensure at least one positive label per sample (clinical realism)
    zero_rows = np.where(y.sum(axis=1) == 0)[0]
    for row in zero_rows:
        rule = CLINICAL_RULES[rule_choices[row]]
        best_drug = max(rule["drugs"], key=rule["drugs"].get)
        y[row, DRUG_IDX[best_drug]] = 1.0

    # Build readable DataFrame
    symptom_cols = [f"sym_{s}" for s in SYMPTOM_LIST]
    drug_cols = [f"rx_{d}" for d in DRUG_LIST]
    df = pd.DataFrame(
        np.hstack([X, y]),
        columns=symptom_cols + drug_cols,
    )
    df["rule"] = [CLINICAL_RULES[r]["name"] for r in rule_choices]

    return X, y, df


if __name__ == "__main__":
    X, y, df = build_dataset()
    print(f"Dataset shape: X={X.shape}, y={y.shape}")
    print(f"Drug prevalences:\n{pd.Series(y.mean(axis=0), index=DRUG_LIST).round(3)}")
    print(df.head())
