# SafeAudit-CDSS: Molecular Substructure Graph & Alert-Fatigue Safety Firewall

> **A Molecular Substructure Graph and Confidence-Calibrated Framework for Mitigating Polypharmacy Drug-Drug Interaction (DDI) Risks and Alert Fatigue in Hospital CPOE Systems.**

---

## 📌 Overview

**SafeAudit-CDSS** is a post-prescription molecular safety firewall and clinical decision support system (CDSS) designed for human hospital physicians drafting Computerized Physician Order Entry (CPOE) prescriptions.

Rather than bombarding clinicians with indiscriminate, un-triaged warnings, SafeAudit-CDSS introduces a dual-engine architecture:
1. **Molecular Substructure Graph Safety Engine (SafeDrug Grounding — IJCAI 2021)**: Dual MPNN graph encoders over atom-bond graphs and BRICS fragmented substructures constrained by a sparse bipartite incidence mask $\mathbf{H} \in \{0, 1\}^{|\mathcal{S}| \times |\mathcal{M}|}$ and adaptive PID loss controller.
2. **Dynamic Confidence-Weighted Alert-Fatigue Triage Firewall (Poly et al. Grounding — JMIR 2020)**: Calibrated ensemble model that suppresses routine non-actionable warnings while enforcing hard stops on life-threatening toxicities.
3. **1-Click Same-Class Safe Substitute Optimizer**: Discovers zero-clash within-class alternatives ($D_{i, j'} = 0$) dynamically.

---

## 🏛️ System Architecture

```text
major_project/
├── backend/
│   ├── main.py                          # FastAPI server & route registration
│   ├── config.py                        # Path configurations & hyperparameters
│   ├── models/
│   │   ├── safedrug_gnn.py              # Dual MPNN & BRICS bipartite graph encoder + PID loss
│   │   ├── alert_fatigue_ensemble.py    # Poly et al. 6-model benchmark & calibrated ensemble
│   │   ├── substitute_optimizer.py      # Within-class zero-DDI substitution finder
│   │   └── train_all.py                 # Unified model training & evaluation pipeline
│   ├── routers/
│   │   ├── patients.py                  # Longitudinal EHR profiles & 4 clinical presets
│   │   ├── audit.py                     # CPOE prescription safety audit endpoint
│   │   ├── molecules.py                 # RDKit 2D SVG molecular rendering & MCS clash highlighting
│   │   └── benchmarks.py                # Academic benchmark payloads & ROC curves
│   ├── data/
│   │   ├── build_clinical_datasets.py   # Dataset builder & ontology harmonizer
│   │   └── processed/                   # Harmonized formulary, DDI pairs, BRICS masks, patients
│   ├── checkpoints/                     # Pre-trained PyTorch weights & Joblib ensembles
│   └── tests/                           # Full-stack E2E verification test suite
├── frontend/
│   ├── src/
│   │   ├── App.tsx                      # Root application & scenario controller
│   │   ├── components/
│   │   │   ├── Header.tsx               # System header with live health indicator
│   │   │   ├── Tab1CpoeFirewall.tsx     # CPOE order pad, triage firewall, RDKit 2D clash viewer
│   │   │   ├── Tab2Cheminformatics.tsx  # 74-drug formulary grid, BRICS graph & ontology lineage
│   │   │   ├── Tab3Benchmarks.tsx       # Recharts ROC curves, PID Pareto frontier, model comparisons
│   │   │   └── DrugDetailModal.tsx      # Deep cheminformatics modal & TwoSIDES links
│   │   ├── services/api.ts              # Typed API client connecting to FastAPI backend
│   │   └── types/index.ts               # Complete TypeScript clinical & molecular schemas
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
└── docs_ref/                            # Literature reference papers (SafeDrug, Poly et al.)
```

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- Python 3.10+
- Node.js 18+ and npm

### 2. Backend Setup
```bash
# Navigate to backend and create virtual environment
cd backend
python -m venv venv

# Activate virtual environment
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install torch rdkit scikit-learn fastapi uvicorn pandas numpy scipy joblib

# Run backend server
python -m uvicorn main:app --app-dir . --host 127.0.0.1 --port 8000
```

### 3. Frontend Setup
```bash
# In a new terminal, navigate to frontend
cd frontend

# Install packages
npm install

# Start Vite development server
npm run dev
```

Open your browser at:
- **Frontend UI**: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- **FastAPI Interactive Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

## 📊 Evaluation & Verification Highlights

- **Formulary**: 74 curated ICU medications across 14 ATC-3 therapeutic classes.
- **DDI Clashes**: 66 TwoSIDES adverse interaction pairs mapped to molecular graphs.
- **BRICS Mask**: $|\mathcal{S}| = 159$ fragments, $\mathbf{H} \in \{0, 1\}^{159 \times 74}$.
- **Alert-Fatigue Reduction**: **70%–87%** spam suppression rate across clinical polypharmacy cases while retaining 100% sensitivity on actionable life-threatening DDIs.
- **PID Controller**: Upper-bounds post-prescription DDI rates below the human MIMIC-III baseline ($4.42\% \le \gamma = 0.06 < 8.08\%$).
