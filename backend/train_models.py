"""
train_models.py
===============
Training script for the Prescription Optimization ensemble models.

Run once before starting the FastAPI server:
  cd backend
  python train_models.py

This will:
1. Synthesize 15,000 EHR-style patient encounters
2. Train MLP + Random Forest on multi-label drug recommendation
3. Save models to backend/ml_engine/saved_models/
4. Print evaluation metrics (Jaccard, PRAUC, Hamming Loss)
"""

import sys
import os

# Ensure imports work from the backend directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "ml_engine"))

from ml_engine.dataset_builder import build_dataset, DRUG_LIST
from ml_engine.ensemble_model import EnsembleRecommender


def main():
    print("=" * 60)
    print(" Prescription Optimization System - Model Training")
    print("=" * 60)

    # Step 1: Build dataset
    print("\n[1/3] Generating synthetic clinical dataset (n=15,000)...")
    X, y, df = build_dataset(n_samples=15_000)
    print(f"      X shape: {X.shape}, y shape: {y.shape}")
    print(f"      Drug prevalences (training set):")
    import numpy as np
    for i, drug in enumerate(DRUG_LIST):
        print(f"        {drug:20s}: {y[:, i].mean():.3f}")

    # Step 2: Train
    print("\n[2/3] Training ensemble models...")
    recommender = EnsembleRecommender()
    metrics = recommender.train(X, y, DRUG_LIST)

    # Step 3: Save
    print("\n[3/3] Saving models...")
    recommender.save()

    # Print results
    print("\n" + "=" * 60)
    print(" Evaluation Metrics (held-out 20% test set)")
    print("=" * 60)
    print(f"  Jaccard Similarity  : {metrics['jaccard']:.4f}")
    print(f"  PRAUC (macro avg)   : {metrics['prauc']:.4f}")
    print(f"  Hamming Loss        : {metrics['hamming_loss']:.4f}")
    print("=" * 60)
    print("\nTraining complete. Start the server with:")
    print("  uvicorn main:app --reload --port 8000")


if __name__ == "__main__":
    main()
