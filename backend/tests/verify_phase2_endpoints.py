"""
SafeAudit-CDSS — backend/tests/verify_phase2_endpoints.py
==========================================================
End-to-End Verification of the 6 FastAPI Endpoints:
  1. GET /api/health
  2. GET /api/patients
  3. GET /api/formulary
  4. GET /api/molecules/{drug_id}/svg?compare_with={other_drug_id}
  5. POST /api/audit-prescription
  6. GET /api/benchmarks
"""

import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_endpoint_health():
    print("\n--- 1. Testing GET /api/health ---")
    res = client.get("/api/health")
    assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
    data = res.json()
    print(f"Status: {data['status']}")
    print(f"SafeDrug GNN Checkpoint: {data['safedrug_gnn_checkpoint']}")
    print(f"Alert Fatigue Checkpoint: {data['alert_fatigue_checkpoint']}")
    print(f"Evaluation Metrics Available: {data['evaluation_metrics_available']}")
    assert data["status"] == "HEALTHY"
    assert data["safedrug_gnn_checkpoint"] is True
    assert data["alert_fatigue_checkpoint"] is True
    assert data["evaluation_metrics_available"] is True
    print("✓ Health Check Passed.")


def test_endpoint_patients():
    print("\n--- 2. Testing GET /api/patients ---")
    res = client.get("/api/patients")
    assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
    data = res.json()
    assert "patients" in data, "Missing 'patients' key"
    assert "demo_cases" in data, "Missing 'demo_cases' key"
    patients = data["patients"]
    demo_cases = data["demo_cases"]
    print(f"Total Longitudinal ICU Patients: {len(patients)}")
    print(f"Total Preset Demo Scenarios: {len(demo_cases)}")
    assert len(patients) >= 30, f"Expected >= 30 patients, found {len(patients)}"
    assert len(demo_cases) == 4, f"Expected 4 demo cases, found {len(demo_cases)}"
    for c in demo_cases:
        print(f"  • {c['case_id']}: {c['title']} ({len(c['draft_prescription'])} meds)")
    print("✓ Patients & Demo Cases Passed.")


def test_endpoint_formulary():
    print("\n--- 3. Testing GET /api/formulary ---")
    res = client.get("/api/formulary")
    assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
    drugs = res.json()
    print(f"Total Formulary Drugs Returned: {len(drugs)}")
    assert len(drugs) >= 50, f"Expected >= 50 drugs, found {len(drugs)}"

    # Check first drug has all required properties
    sample = drugs[0]
    print(f"Sample Drug: {sample['name']} ({sample['drug_id']})")
    print(f"  RxCUI: {sample['rxcui']}, NDC: {sample['ndc_code']}, ATC3: {sample['atc3_code']}")
    print(f"  Mol Wt: {sample['molecular_weight']}, LogP: {sample['logp']}, TPSA: {sample['tpsa']}")
    print(f"  BRICS Fragments Count: {sample['brics_fragment_count']}")

    assert "ndc_code" in sample
    assert "rxcui" in sample
    assert "atc3_code" in sample
    assert "smiles" in sample
    assert "molecular_weight" in sample
    assert "brics_fragments" in sample
    print("✓ Formulary & Molecular Properties Passed.")


def test_endpoint_molecule_svg():
    print("\n--- 4. Testing GET /api/molecules/{drug_id}/svg?compare_with={other_drug_id} ---")
    # Clopidogrel (B01AC04) vs Omeprazole (A02BC01)
    res = client.get("/api/molecules/B01AC04/svg?compare_with=A02BC01")
    assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
    data = res.json()
    assert "svg" in data
    assert "<svg" in data["svg"]
    assert "molecular_weight" in data
    assert "brics_fragments" in data
    print(f"Drug: {data['drug_name']} ({data['drug_id']})")
    print(f"Molecular Weight: {data['molecular_weight']}")
    print(f"BRICS Fragments: {len(data['brics_fragments'])}")
    if data.get("clash_highlight"):
        print(f"MCS Highlight Atoms: {data['clash_highlight']['num_shared_atoms']}")
        print(f"Highlight Color: {data['clash_highlight']['highlight_hex']}")
        assert data["clash_highlight"]["highlight_hex"] == "#EB3838"
    print("✓ Molecule SVG Rendering & Crimson Highlight Passed.")


def test_endpoint_audit_prescription():
    print("\n--- 5. Testing POST /api/audit-prescription ---")
    payload = {
        "patient_id": "PT-1001",
        "drug_ids": ["B01AC04", "A02BC01", "B01AC06", "C10AA01"],  # Clopidogrel, Omeprazole, Aspirin, Simvastatin
        "department_id": "Cardiology",
        "pid_gamma": 0.06
    }
    res = client.post("/api/audit-prescription", json=payload)
    assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
    audit = res.json()

    # Check Summary schema
    summary = audit["summary"]
    print("Audit Summary:")
    print(f"  Total Drugs: {summary['total_drugs']}")
    print(f"  Pairs Checked: {summary['total_pairs_checked']}")
    print(f"  Raw Rule Alerts: {summary['raw_rule_alerts_count']}")
    print(f"  Suppressed Spam: {summary['suppressed_spam_count']}")
    print(f"  Alert Fatigue Reduction: {summary['alert_fatigue_reduction_pct']}")
    print(f"  Passive Inline Warnings: {summary['passive_warnings_count']}")
    print(f"  Hard Stop Critical: {summary['hard_stop_count']}")
    print(f"  Set DDI Rate: {summary['set_ddi_rate']}")
    print(f"  Safety Status: {summary['safety_status']}")

    assert "total_drugs" in summary
    assert "total_pairs_checked" in summary
    assert "raw_rule_alerts_count" in summary
    assert "suppressed_spam_count" in summary
    assert "alert_fatigue_reduction_pct" in summary
    assert "passive_warnings_count" in summary
    assert "hard_stop_count" in summary
    assert "set_ddi_rate" in summary
    assert "safety_status" in summary

    # Check Alerts schema
    alerts = audit["alerts"]
    print(f"\nAlerts Returned: {len(alerts)}")
    for a in alerts:
        print(f"  • {a['drug_a']} + {a['drug_b']} | Severity: {a['severity']} | Tier: {a['alert_tier']}")
        print(f"    P(override)={a['override_probability']}, P(accept)={a['acceptance_probability']}, Epistemic Unc={a['epistemic_uncertainty']}")
        print(f"    BRICS Cosine Sim: {a['brics_cosine_sim']}, Shared Motifs: {len(a['shared_substructures'])}")
        assert a["alert_tier"] in ["HARD_STOP_CRITICAL", "PASSIVE_INLINE_WARNING", "SUPPRESSED_SPAM"]
        assert "twosides_effect" in a
        assert "mechanism" in a
        assert "override_probability" in a
        assert "acceptance_probability" in a
        assert "epistemic_uncertainty" in a
        assert "brics_cosine_sim" in a

    # Check Safe Substitutes schema
    subs = audit["safe_substitutes"]
    print(f"\nSafe 1-Click Substitutes: {len(subs)}")
    for s in subs:
        print(f"  -> Replace {s['replace_drug_name']} ({s['replace_drug_id']}) with {s['substitute_name']} ({s['substitute_drug_id']})")
        print(f"     Class: {s['atc_class']} | New Set DDI Rate: {s['new_set_ddi_rate']}")
        print(f"     Reason: {s['reason'][:90]}...")
        assert "replace_drug_id" in s
        assert "substitute_drug_id" in s
        assert "substitute_name" in s
        assert "atc_class" in s
        assert "new_set_ddi_rate" in s
        assert "reason" in s

    print("✓ Audit-Prescription Endpoint Passed.")


def test_endpoint_benchmarks():
    print("\n--- 6. Testing GET /api/benchmarks ---")
    res = client.get("/api/benchmarks")
    assert res.status_code == 200, f"Error {res.status_code}: {res.text}"
    bench = res.json()
    assert "alert_fatigue_models" in bench, "Missing 'alert_fatigue_models'"
    assert "longitudinal_ehr_baselines" in bench, "Missing 'longitudinal_ehr_baselines'"
    assert "pareto_tradeoff_curve" in bench, "Missing 'pareto_tradeoff_curve'"
    assert "bipartite_mask_ablation" in bench, "Missing 'bipartite_mask_ablation'"

    print(f"Alert Fatigue Models: {len(bench['alert_fatigue_models'])}")
    print(f"Longitudinal EHR Baselines: {len(bench['longitudinal_ehr_baselines'])}")
    print(f"Pareto Frontier Points: {len(bench['pareto_tradeoff_curve'])}")
    print(f"Mask Ablation Table 5: {bench['bipartite_mask_ablation']['table_5_replication']}")
    print("✓ Academic Benchmarks Endpoint Passed.")


if __name__ == "__main__":
    print("===============================================================")
    print("SAFEDRUG-CDSS FASTAPI ENDPOINT VERIFICATION SUITE")
    print("===============================================================")
    test_endpoint_health()
    test_endpoint_patients()
    test_endpoint_formulary()
    test_endpoint_molecule_svg()
    test_endpoint_audit_prescription()
    test_endpoint_benchmarks()
    print("\n===============================================================")
    print("ALL 6 FASTAPI ENDPOINTS VERIFIED AND PASSING (6/6)!")
    print("===============================================================")
