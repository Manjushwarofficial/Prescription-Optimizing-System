"""
SafeAudit-CDSS — backend/tests/verify_phase2.py
================================================
Comprehensive Phase 2 Verification Suite.
Validates all Phase 2 components:
  1. FastAPI application startup & /api/health
  2. Patient cohort and demo scenarios endpoints
  3. POST /api/audit on Demo Case 1 (Clopidogrel + Omeprazole -> Pantoprazole substitute)
  4. POST /api/audit on Demo Case 2 (Simvastatin + Amiodarone -> Rosuvastatin substitute)
  5. GET /api/audit/pair pairwise clash analysis
  6. Molecular SVG rendering with MCS crimson highlight
  7. Literature benchmarks & model checkpoint metrics (SafeDrug & Poly et al.)
"""

import os
import sys
from pathlib import Path

# Add backend to sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_health():
    print("\n--- 1. Testing GET /api/health ---")
    res = client.get("/api/health")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    print(f"Status: {data['status']}")
    print(f"SafeDrug GNN Checkpoint: {data['safedrug_gnn_checkpoint']}")
    print(f"Alert Fatigue Checkpoint: {data['alert_fatigue_checkpoint']}")
    assert data["status"] == "HEALTHY", "System is not in HEALTHY state"
    assert data["safedrug_gnn_checkpoint"] is True
    assert data["alert_fatigue_checkpoint"] is True
    print("✓ Health Check Passed.")


def test_patients_and_demo_cases():
    print("\n--- 2. Testing Patients & Demo Cases Endpoints ---")
    # Patients list
    res = client.get("/api/patients")
    assert res.status_code == 200
    patients = res.json()
    print(f"Total Patients Returned: {len(patients)}")
    assert len(patients) >= 30, f"Expected >= 30 patients, got {len(patients)}"

    # Single patient
    pid = patients[0]["patient_id"]
    res_single = client.get(f"/api/patients/{pid}")
    assert res_single.status_code == 200
    pdata = res_single.json()
    print(f"Patient {pid} visits: {len(pdata['visits'])}, tolerated meds: {len(pdata['tolerated_meds'])}")

    # Demo cases
    res_demo = client.get("/api/patients/demo/cases")
    assert res_demo.status_code == 200
    demo_cases = res_demo.json()
    print(f"Total Demo Cases: {len(demo_cases)}")
    assert len(demo_cases) == 4, f"Expected 4 demo cases, got {len(demo_cases)}"
    for case in demo_cases:
        print(f"  • {case['case_id']}: {case['title']} ({len(case['draft_prescription'])} meds)")
    print("✓ Patients & Demo Cases Passed.")


def test_audit_demo_case_1():
    print("\n--- 3. Testing POST /api/audit (Demo Case 1: Stent + PPI Clash) ---")
    payload = {
        "patient_id": "PAT_ICU_001",
        "physician_id": "DR_ICU_042",
        "department_id": "Cardiology",
        "prescribed_drugs": ["Clopidogrel", "Omeprazole", "Aspirin", "Atorvastatin"],
        "include_substitutes": True
    }
    res = client.post("/api/audit", json=payload)
    assert res.status_code == 200, f"Audit failed: {res.text}"
    audit = res.json()
    print(f"Audit Status: {audit['status']}")
    print(f"Message: {audit['message']}")
    print(f"Latency: {audit['execution_latency_ms']} ms")
    print(f"Alerts Found: {audit['audit_summary']['total_ddi_alerts_found']}")
    print(f"Alert Fatigue Reduction: {audit['audit_summary']['alert_fatigue_reduction_pct']}")

    # Verify Clopidogrel + Omeprazole was flagged
    alerts = audit["ddi_alerts"]
    clopidogrel_omeprazole_found = False
    substitute_found = False

    for alert in alerts:
        d_a = alert["drug_a"]["name"]
        d_b = alert["drug_b"]["name"]
        pair_names = {d_a, d_b}
        print(f"  Alert: {d_a} + {d_b} | Tier: {alert['triage_decision']['tier']} | Severity: {alert['severity_tier']}")
        print(f"  Adverse Effect: {alert['twosides_adverse_effect']}")

        if pair_names == {"Clopidogrel", "Omeprazole"}:
            clopidogrel_omeprazole_found = True
            subs = alert["safe_substitutes"]["for_drug_b"]
            print(f"  Safe Substitutes for Omeprazole:")
            for sub in subs:
                print(f"    -> {sub['candidate_name']} ({sub['candidate_id']}) | BRICS Tanimoto: {sub['tanimoto_similarity']} | Safe (D=0): {sub['is_zero_ddi']}")
                if sub["candidate_name"] in ["Pantoprazole", "Famotidine", "Rabeprazole", "Esomeprazole"]:
                    substitute_found = True

    assert clopidogrel_omeprazole_found, "Clopidogrel + Omeprazole DDI was NOT detected!"
    assert substitute_found, "Pantoprazole/within-class substitute for Omeprazole was NOT found!"
    print("✓ Demo Case 1 Audit & Substitute Recommendation Passed.")


def test_audit_demo_case_2():
    print("\n--- 4. Testing POST /api/audit (Demo Case 2: Simvastatin + Amiodarone Clash) ---")
    payload = {
        "patient_id": "PAT_ICU_002",
        "physician_id": "DR_ICU_088",
        "department_id": "Cardiology",
        "prescribed_drugs": ["Simvastatin", "Amiodarone", "Warfarin", "Furosemide"],
        "include_substitutes": True
    }
    res = client.post("/api/audit", json=payload)
    assert res.status_code == 200, f"Audit failed: {res.text}"
    audit = res.json()
    print(f"Audit Status: {audit['status']}")
    print(f"Total DDI Alerts: {len(audit['ddi_alerts'])}")

    simvastatin_amio_found = False
    for alert in audit["ddi_alerts"]:
        pair = {alert["drug_a"]["name"], alert["drug_b"]["name"]}
        if pair == {"Simvastatin", "Amiodarone"}:
            simvastatin_amio_found = True
            print(f"  Flagged Simvastatin + Amiodarone -> Severity: {alert['severity_tier']}")
            subs = alert["safe_substitutes"]["for_drug_a"]
            print(f"  Safe Statin Substitutes for Simvastatin:")
            for s in subs:
                print(f"    -> {s['candidate_name']} | D=0 Safe: {s['is_zero_ddi']}")

    assert simvastatin_amio_found, "Simvastatin + Amiodarone DDI was NOT detected!"
    print("✓ Demo Case 2 Audit Passed.")


def test_pairwise_endpoint():
    print("\n--- 5. Testing GET /api/audit/pair ---")
    res = client.get("/api/audit/pair?drug_a=Clopidogrel&drug_b=Omeprazole")
    assert res.status_code == 200
    data = res.json()
    print(f"Known TwoSIDES: {data['is_known_twosides_ddi']}")
    print(f"SafeDrug GNN Prob: {data['safedrug_gnn_prediction']['ddi_probability']}")
    print(f"Shared BRICS Count: {data['shared_brics_count']}")
    print(f"Visual SVG URL: {data['visual_clash_svg_url']}")
    assert data["is_known_twosides_ddi"] is True
    print("✓ Pairwise Endpoint Passed.")


def test_molecule_svg():
    print("\n--- 6. Testing GET /api/molecules/{drug_id}/svg ---")
    # Test JSON structure
    res = client.get("/api/molecules/B01AC06/svg?clash_with=A02BC01")
    assert res.status_code == 200
    data = res.json()
    assert "svg" in data
    assert "<svg" in data["svg"]
    print(f"Drug: {data['drug_name']} ({data['drug_id']})")
    print(f"Mol Wt: {data['molecular_weight']}, LogP: {data['logp']}")
    if data["clash_highlight"]:
        print(f"Clash Highlighted Atoms: {data['clash_highlight']['num_shared_atoms']}")
        print(f"Clash Highlight Hex: {data['clash_highlight']['highlight_hex']}")
        assert data["clash_highlight"]["highlight_hex"] == "#EB3838"

    # Test direct raw SVG content
    res_raw = client.get("/api/molecules/B01AC06/svg?raw=true")
    assert res_raw.status_code == 200
    assert "image/svg+xml" in res_raw.headers.get("content-type", "")
    assert "<svg" in res_raw.text
    print("✓ Molecule SVG Rendering & Crimson Highlight Passed.")


def test_benchmarks():
    print("\n--- 7. Testing GET /api/benchmarks & Evaluation Metrics ---")
    res = client.get("/api/benchmarks")
    assert res.status_code == 200
    data = res.json()
    citations = [c["citation_key"] for c in data["citations"]]
    print(f"Citations present: {citations}")
    assert "SafeDrug-IJCAI2021" in citations
    assert "GAMENet-AAAI2019" in citations
    assert "Poly-JMIR2020" in citations

    # 1. Longitudinal EHR Baselines
    ddi_bench = data.get("longitudinal_ehr_baselines", data.get("safedrug_ddi_benchmarks", {}).get("models", []))
    print(f"Evaluated Longitudinal EHR baseline models count: {len(ddi_bench)}")
    assert len(ddi_bench) == 6, f"Expected 6 baselines, found {len(ddi_bench)}"
    safedrug_entry = next(m for m in ddi_bench if "SafeAudit" in m["model_name"])
    print(f"SafeAudit GNN DDI Rate: {safedrug_entry['DDI_Rate']}, Jaccard: {safedrug_entry['Jaccard']}, F1: {safedrug_entry['F1']}")
    assert safedrug_entry["DDI_Rate"] < 0.05
    assert safedrug_entry["Jaccard"] > 0.50

    # 2. Alert-Fatigue 6-Model Benchmark
    af_bench = data.get("alert_fatigue_models", data.get("alert_fatigue_benchmarks", {}).get("models", []))
    print(f"Total alert fatigue models evaluated: {len(af_bench)}")
    assert len(af_bench) == 6, f"Expected 6 benchmarked models, found {len(af_bench)}"
    for m in af_bench:
        print(f"  • {m['model_name']}: AUROC={m['AUROC']}, Acc={m['Accuracy']}, Sens={m['Sensitivity']}, Spec={m['Specificity']}, PPV={m['PPV']}, NPV={m['NPV']}")
        assert "roc_curve" in m
        assert len(m["roc_curve"]["fpr"]) > 10
        assert len(m["roc_curve"]["tpr"]) > 10

    ensemble_entry = next(m for m in af_bench if "Ensemble" in m["model_name"])
    print(f"Ours Ensemble AUROC: {ensemble_entry['AUROC']}, Brier: {ensemble_entry['Brier']}")
    assert ensemble_entry["AUROC"] >= 0.88

    # 3. Pareto Trade-Off Curve Data
    pareto = data.get("pareto_tradeoff_curve", [])
    print(f"Pareto trade-off curve points count: {len(pareto)}")
    assert len(pareto) >= 9, f"Expected 9 gamma points, found {len(pareto)}"
    print(f"  Pareto gamma=0.00: DDI={pareto[0]['DDI_Rate']} | gamma=0.08: DDI={pareto[-1]['DDI_Rate']}")

    # 4. SafeDrug Table 5 Bipartite Mask Cosine Verification
    table5 = data.get("bipartite_mask_ablation", data.get("safedrug_table5_mask_verification", {}))
    print(f"Table 5 Replication Status: {table5.get('table_5_replication')}")
    assert table5.get("with_mask_H", {}).get("condition_satisfied") is True
    print(f"  With Mask H: Cos_interacted={table5['with_mask_H']['Cos_interacted']} < 0 < Cos_all={table5['with_mask_H']['Cos_all']}")

    res_models = client.get("/api/benchmarks/models")
    assert res_models.status_code == 200
    models_data = res_models.json()
    assert models_data["safedrug_dual_gnn"]["is_trained"] is True
    assert models_data["alert_fatigue_ensemble"]["is_trained"] is True
    print("✓ Benchmarks & Model Status Passed.")


if __name__ == "__main__":
    print("===============================================================")
    print("SAFEDRUG-CDSS PHASE 2 VERIFICATION TEST SUITE")
    print("===============================================================")
    test_health()
    test_patients_and_demo_cases()
    test_audit_demo_case_1()
    test_audit_demo_case_2()
    test_pairwise_endpoint()
    test_molecule_svg()
    test_benchmarks()
    print("\n===============================================================")
    print("ALL PHASE 2 VERIFICATION TESTS PASSED SUCCESSFULLY (7/7)!")
    print("===============================================================")
