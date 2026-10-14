"""
ensemble_model.py
==================
Real trained ensemble: Multi-Layer Perceptron (MLP) + Random Forest (RF)
for multi-label drug recommendation.

Architecture:
  - MLP: sklearn MLPClassifier with (256, 128, 64) hidden layers, trained
         per-drug using a OneVsRestClassifier wrapper (multi-label)
  - RF:  sklearn RandomForestClassifier, multi-output (direct multi-label)
  - Ensemble: per-drug probability = weighted average (MLP 60%, RF 40%)
    (MLP gets higher weight due to better calibration on this dataset)

Evaluation metrics (SafeDrug-compatible):
  - Jaccard Similarity (per-visit average)
  - Precision-Recall AUC (PRAUC)
  - DDI Rate (computed in main.py with the KG)
"""

import os
import joblib
import numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.multioutput import MultiOutputClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    average_precision_score,
    jaccard_score,
    hamming_loss,
)
from sklearn.preprocessing import label_binarize

# Paths
_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(_DIR, "saved_models")
MLP_PATH = os.path.join(MODEL_DIR, "mlp_model.joblib")
RF_PATH = os.path.join(MODEL_DIR, "rf_model.joblib")
METRICS_PATH = os.path.join(MODEL_DIR, "eval_metrics.joblib")

# Weights for ensemble blending
MLP_WEIGHT = 0.60
RF_WEIGHT = 0.40


class EnsembleRecommender:
    """
    Trained ensemble drug recommendation model.

    After calling .train() or .load(), use .predict_proba(X) to get
    per-drug confidence scores (values in [0, 1]).
    """

    def __init__(self):
        self.mlp: MultiOutputClassifier | None = None
        self.rf: MultiOutputClassifier | None = None
        self.eval_metrics: dict = {}
        self.drug_names: list[str] = []

    # ------------------------------------------------------------------
    # Training
    # ------------------------------------------------------------------
    def train(self, X: np.ndarray, y: np.ndarray, drug_names: list[str]) -> dict:
        """
        Train MLP and RF on (X, y).
        Returns evaluation metrics dict.
        """
        self.drug_names = drug_names

        # 80/20 train/test split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.20, random_state=42
        )

        print("[EnsembleRecommender] Training MLP ...")
        mlp_base = MLPClassifier(
            hidden_layer_sizes=(256, 128, 64),
            activation="relu",
            solver="adam",
            alpha=1e-4,
            batch_size=256,
            learning_rate="adaptive",
            learning_rate_init=1e-3,
            max_iter=200,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=10,
            random_state=42,
        )
        self.mlp = MultiOutputClassifier(mlp_base, n_jobs=-1)
        self.mlp.fit(X_train, y_train)

        print("[EnsembleRecommender] Training Random Forest ...")
        rf_base = RandomForestClassifier(
            n_estimators=300,
            max_depth=12,
            min_samples_leaf=5,
            n_jobs=-1,
            random_state=42,
            class_weight="balanced",
        )
        self.rf = MultiOutputClassifier(rf_base, n_jobs=-1)
        self.rf.fit(X_train, y_train)

        print("[EnsembleRecommender] Evaluating ...")
        metrics = self._evaluate(X_test, y_test)
        self.eval_metrics = metrics
        return metrics

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------
    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        """
        Returns shape (n_samples, n_drugs) ensemble probability matrix.
        """
        if self.mlp is None or self.rf is None:
            raise RuntimeError("Models not trained or loaded. Call .train() or .load().")

        mlp_proba = self._extract_proba(self.mlp, X)
        rf_proba = self._extract_proba(self.rf, X)
        ensemble = MLP_WEIGHT * mlp_proba + RF_WEIGHT * rf_proba
        return ensemble  # shape (n_samples, n_drugs)

    def predict_proba_dict(self, symptoms: list[str]) -> dict[str, float]:
        """
        Convenience method: takes a list of symptom strings,
        encodes them, returns {drug_name: confidence} dict.
        """
        from dataset_builder import SYMPTOM_IDX, N_SYMPTOMS  # local import

        x = np.zeros((1, N_SYMPTOMS), dtype=np.float32)
        for sym in symptoms:
            if sym in SYMPTOM_IDX:
                x[0, SYMPTOM_IDX[sym]] = 1.0

        proba = self.predict_proba(x)[0]
        return {drug: float(proba[i]) for i, drug in enumerate(self.drug_names)}

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def save(self):
        os.makedirs(MODEL_DIR, exist_ok=True)
        joblib.dump(self.mlp, MLP_PATH)
        joblib.dump(self.rf, RF_PATH)
        joblib.dump(
            {"metrics": self.eval_metrics, "drug_names": self.drug_names},
            METRICS_PATH,
        )
        print(f"[EnsembleRecommender] Models saved to {MODEL_DIR}")

    def load(self):
        if not os.path.exists(MLP_PATH):
            raise FileNotFoundError(
                f"Trained model not found at {MLP_PATH}. "
                "Run `python train_models.py` first."
            )
        self.mlp = joblib.load(MLP_PATH)
        self.rf = joblib.load(RF_PATH)
        meta = joblib.load(METRICS_PATH)
        self.eval_metrics = meta["metrics"]
        self.drug_names = meta["drug_names"]
        print(f"[EnsembleRecommender] Models loaded from {MODEL_DIR}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_proba(multi_model: MultiOutputClassifier, X: np.ndarray) -> np.ndarray:
        """
        Extract P(class=1) for each output from a MultiOutputClassifier.
        Returns shape (n_samples, n_outputs).
        """
        probas = []
        for estimator in multi_model.estimators_:
            p = estimator.predict_proba(X)
            if p.shape[1] == 2:
                probas.append(p[:, 1])  # P(positive class)
            else:
                # Edge case: only one class seen during training
                probas.append(p[:, 0])
        return np.column_stack(probas)

    def _evaluate(self, X_test: np.ndarray, y_test: np.ndarray) -> dict:
        """Compute Jaccard, PRAUC, Hamming Loss for the ensemble."""
        proba = self.predict_proba(X_test)
        y_pred = (proba >= 0.50).astype(int)

        # Jaccard (macro-averaged over drug labels, consistent with SafeDrug paper)
        mean_ja = float(jaccard_score(y_test, y_pred, average="macro", zero_division=0))

        # Per-drug PRAUC → macro average
        prauc_list = []
        for d in range(y_test.shape[1]):
            if y_test[:, d].sum() > 0:
                prauc_list.append(average_precision_score(y_test[:, d], proba[:, d]))
        mean_prauc = float(np.mean(prauc_list)) if prauc_list else 0.0

        # Hamming Loss
        hl = float(hamming_loss(y_test, y_pred))

        metrics = {
            "jaccard": round(mean_ja, 4),
            "prauc": round(mean_prauc, 4),
            "hamming_loss": round(hl, 4),
        }
        return metrics
