"""
SafeAudit-CDSS — backend/tests/test_live_server.py
===================================================
Automated Live Uvicorn Server Verification Script.
Starts `uvicorn backend.main:app --port 8000`, waits for readiness,
and performs HTTP probe requests verifying valid JSON on:
  1. GET  /api/health
  2. GET  /api/patients
  3. POST /api/audit-prescription
  4. GET  /api/molecules/warfarin/svg?compare_with=aspirin
  5. GET  /api/benchmarks
Then gracefully shuts down the server.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

BASE_URL = "http://127.0.0.1:8000"


def wait_for_server(timeout_sec: float = 15.0) -> bool:
    start = time.time()
    while time.time() - start < timeout_sec:
        try:
            res = httpx.get(f"{BASE_URL}/api/health", timeout=1.5)
            if res.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def run_tests():
    print("=" * 70)
    print("LAUNCHING LIVE UVICORN SERVER & VERIFYING JSON ENDPOINTS")
    print("=" * 70)

    # 1. Start uvicorn process
    env = os.environ.copy()
    python_exe = sys.executable
    cmd = [python_exe, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"]
    print(f"Starting server: {' '.join(cmd)}")
    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    try:
        ready = wait_for_server(timeout_sec=20.0)
        if not ready:
            stdout, stderr = proc.communicate(timeout=2)
            print("Server failed to start within timeout.")
            print("STDOUT:", stdout.decode("utf-8", errors="ignore"))
            print("STDERR:", stderr.decode("utf-8", errors="ignore"))
            sys.exit(1)

        print("Server is ONLINE at http://127.0.0.1:8000. Commencing API probe tests...\n")

        with httpx.Client(base_url=BASE_URL, timeout=10.0) as client:
            # ---------------------------------------------------------------
            # Test 1: GET /api/health
            # ---------------------------------------------------------------
            print("--- 1. Testing GET /api/health ---")
            r_health = client.get("/api/health")
            assert r_health.status_code == 200, f"Health check failed: {r_health.text}"
            data_health = r_health.json()
            print("Response status:", data_health.get("status"))
            print("GNN Checkpoint:", data_health.get("safedrug_gnn_checkpoint"))
            print("Alert Fatigue Checkpoint:", data_health.get("alert_fatigue_checkpoint"))
            assert data_health["status"] == "HEALTHY"
            print("✓ /api/health returned valid JSON (200 OK)\n")

            # ---------------------------------------------------------------
            # Test 2: GET /api/patients
            # ---------------------------------------------------------------
            print("--- 2. Testing GET /api/patients ---")
            r_patients = client.get("/api/patients")
            assert r_patients.status_code == 200, f"/api/patients failed: {r_patients.text}"
            data_patients = r_patients.json()
            assert "patients" in data_patients, "Missing 'patients' key"
            assert "demo_cases" in data_patients, "Missing 'demo_cases' key"
            print(f"Total Longitudinal Patients: {len(data_patients['patients'])}")
            print(f"Total Preset Demo Cases: {len(data_patients['demo_cases'])}")
            assert len(data_patients["patients"]) >= 30
            assert len(data_patients["demo_cases"]) == 4
            print("✓ /api/patients returned valid JSON (200 OK)\n")

            # ---------------------------------------------------------------
            # Test 3: POST /api/audit-prescription
            # ---------------------------------------------------------------
            print("--- 3. Testing POST /api/audit-prescription ---")
            payload = {
                "patient_id": "PT-1001",
                "drug_ids": ["B01AC04", "A02BC01", "B01AC06"],  # Clopidogrel, Omeprazole, Aspirin
                "department_id": "Cardiology",
                "pid_gamma": 0.06
            }
            r_audit = client.post("/api/audit-prescription", json=payload)
            assert r_audit.status_code == 200, f"/api/audit-prescription failed: {r_audit.text}"
            data_audit = r_audit.json()
            assert "summary" in data_audit, "Missing 'summary' key"
            assert "alerts" in data_audit, "Missing 'alerts' key"
            assert "safe_substitutes" in data_audit, "Missing 'safe_substitutes' key"

            summary = data_audit["summary"]
            print("Audit Summary:")
            print(f"  Safety Status: {summary['safety_status']}")
            print(f"  Total Pairs Checked: {summary['total_pairs_checked']}")
            print(f"  Raw Rule Alerts: {summary['raw_rule_alerts_count']}")
            print(f"  Suppressed Spam: {summary['suppressed_spam_count']}")
            print(f"  Alert Fatigue Reduction: {summary['alert_fatigue_reduction_pct']}")
            print(f"  Passive Inline Warnings: {summary['passive_warnings_count']}")
            print(f"  Hard Stop Critical: {summary['hard_stop_count']}")
            print(f"  Set DDI Rate: {summary['set_ddi_rate']}")

            print(f"Alerts Found: {len(data_audit['alerts'])}")
            for a in data_audit["alerts"]:
                print(f"  • {a['drug_a']} + {a['drug_b']} | Severity: {a['severity']} | Tier: {a['alert_tier']}")
                print(f"    Effect: {a['twosides_effect']}")
                print(f"    P(override)={a['override_probability']}, P(accept)={a['acceptance_probability']}, Epistemic Unc={a['epistemic_uncertainty']}")

            print(f"Safe 1-Click Substitutes: {len(data_audit['safe_substitutes'])}")
            for s in data_audit["safe_substitutes"][:3]:
                print(f"  -> Replace {s['replace_drug_name']} with {s['substitute_name']} ({s['atc_class']}) | New DDI Rate: {s['new_set_ddi_rate']}")

            print("✓ /api/audit-prescription returned valid JSON (200 OK)\n")

            # ---------------------------------------------------------------
            # Test 4: GET /api/molecules/warfarin/svg?compare_with=aspirin
            # ---------------------------------------------------------------
            print("--- 4. Testing GET /api/molecules/warfarin/svg?compare_with=aspirin ---")
            r_mol = client.get("/api/molecules/warfarin/svg?compare_with=aspirin")
            assert r_mol.status_code == 200, f"/api/molecules/warfarin/svg failed: {r_mol.text}"
            data_mol = r_mol.json()
            assert "svg" in data_mol, "Missing 'svg' key"
            assert "<svg" in data_mol["svg"], "SVG string does not contain <svg markup"
            assert "</svg>" in data_mol["svg"], "SVG string does not contain </svg> markup"
            assert "molecular_weight" in data_mol, "Missing 'molecular_weight' key"
            assert "brics_fragments" in data_mol, "Missing 'brics_fragments' key"

            print(f"Drug: {data_mol['drug_name']} ({data_mol['drug_id']})")
            print(f"Molecular Weight: {data_mol['molecular_weight']}")
            print(f"LogP: {data_mol['logp']}")
            print(f"BRICS Fragments: {data_mol['brics_fragments']}")
            if data_mol.get("clash_highlight"):
                clash = data_mol["clash_highlight"]
                print(f"Clashing with: {clash['clashing_drug_name']} ({clash['clashing_drug_id']})")
                print(f"MCS Highlight Atoms: {clash['num_shared_atoms']}")
                print(f"Highlight Color: {clash['highlight_hex']}")
                assert clash["highlight_hex"] == "#EB3838"

            print("✓ /api/molecules/warfarin/svg?compare_with=aspirin returned valid JSON (200 OK)\n")

            # ---------------------------------------------------------------
            # Test 5: GET /api/benchmarks
            # ---------------------------------------------------------------
            print("--- 5. Testing GET /api/benchmarks ---")
            r_bench = client.get("/api/benchmarks")
            assert r_bench.status_code == 200, f"/api/benchmarks failed: {r_bench.text}"
            data_bench = r_bench.json()
            assert "alert_fatigue_models" in data_bench, "Missing 'alert_fatigue_models'"
            assert "longitudinal_ehr_baselines" in data_bench, "Missing 'longitudinal_ehr_baselines'"
            assert "pareto_tradeoff_curve" in data_bench, "Missing 'pareto_tradeoff_curve'"
            assert "bipartite_mask_ablation" in data_bench, "Missing 'bipartite_mask_ablation'"

            print(f"Alert Fatigue Benchmarked Models: {len(data_bench['alert_fatigue_models'])}")
            for m in data_bench["alert_fatigue_models"]:
                print(f"  • {m['model_name']}: AUROC={m['AUROC']}, Acc={m['Accuracy']}, Sens={m['Sensitivity']}, Spec={m['Specificity']}")
                assert "roc_curve" in m
                assert len(m["roc_curve"]["fpr"]) > 10

            print(f"Longitudinal EHR Baselines: {len(data_bench['longitudinal_ehr_baselines'])}")
            print(f"Pareto Trade-Off Points: {len(data_bench['pareto_tradeoff_curve'])}")
            print(f"Table 5 Replication Status: {data_bench['bipartite_mask_ablation']['table_5_replication']}")
            print("✓ /api/benchmarks returned valid JSON (200 OK)\n")

        print("=" * 70)
        print("ALL SPECIFIED LIVE API ENDPOINTS RETURNED VALID 200 OK JSON RESPONSES!")
        print("PHASE 2 VERIFICATION COMPLETE AND PASSING!")
        print("=" * 70)

    finally:
        print("Stopping uvicorn process...")
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
        print("Uvicorn process stopped.")


if __name__ == "__main__":
    run_tests()
