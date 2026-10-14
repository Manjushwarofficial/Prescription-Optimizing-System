"""
test_phase2_pipeline.py
=======================
Unit tests for Phase 2 longitudinal EHR & ontological data pipeline.

Tests can be run without any credentialed PhysioNet or SNOMED CT files —
all tests use mock data generated in-process.

Run with:
    python -m pytest backend/src/tests/test_phase2_pipeline.py -v
    # or from backend/src/tests/:
    python test_phase2_pipeline.py
"""

from __future__ import annotations

import os
import sys
import unittest
import io
import gzip
from pathlib import Path

import numpy as np
import pandas as pd

# Ensure project root is on path
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_BACKEND_DIR))

from src.data.ehr_loader import (
    VisitRecord,
    PatientTrajectory,
    LegacyCSVLoader,
    generate_mock_mimic_demo,
)
from src.ontology.clinical_mapper import (
    ClinicalOntologyMapper,
    get_mock_mapper,
    generate_mock_snomed_dag,
)
from src.ontology.drug_mapper import (
    DrugOntologyMapper,
    _FORMULARY_NDC_MAP,
    _FORMULARY_NAME_MAP,
)
from src.graph.ddi_builder import (
    DDIGraphBuilder,
    build_formulary_ddi_graph,
    FORMULARY,
)


# ===========================================================================
# EHR Loader Tests
# ===========================================================================

class TestVisitRecord(unittest.TestCase):
    """Unit tests for the VisitRecord data structure."""

    def test_to_dict(self):
        vr = VisitRecord(
            hadm_id=12345,
            admittime=pd.Timestamp("2020-01-01"),
            dischtime=pd.Timestamp("2020-01-05"),
            icd_codes=frozenset(["I10", "E11.9"]),
            procedures=frozenset(["3E0T3MZ"]),
            drugs_ndc=["00071015523"],
            lab_flags={"50912": "abnormal"},
        )
        d = vr.to_dict()
        self.assertEqual(d["hadm_id"], 12345)
        self.assertIn("I10", d["icd_codes"])
        self.assertIn("00071015523", d["drugs_ndc"])

    def test_patient_trajectory_len(self):
        v1 = VisitRecord(1, pd.Timestamp("2020-01-01"), pd.Timestamp("2020-01-05"))
        v2 = VisitRecord(2, pd.Timestamp("2021-01-01"), pd.Timestamp("2021-01-05"))
        traj = PatientTrajectory(subject_id=42, visits=[v1, v2], source="test")
        self.assertEqual(len(traj), 2)

    def test_trajectory_iter(self):
        visits = [
            VisitRecord(i, pd.Timestamp("2020-01-01"), pd.Timestamp("2020-01-02"))
            for i in range(3)
        ]
        traj = PatientTrajectory(subject_id=1, visits=visits)
        for v, expected_id in zip(traj, range(3)):
            self.assertEqual(v.hadm_id, expected_id)


class TestMockMIMICDemo(unittest.TestCase):
    """Test the mock MIMIC-IV data generator."""

    def test_generates_expected_count(self):
        data = generate_mock_mimic_demo(n_patients=5)
        self.assertEqual(len(data), 5)

    def test_visits_are_chronological(self):
        data = generate_mock_mimic_demo(n_patients=3)
        for traj in data:
            admit_times = [v.admittime for v in traj.visits]
            self.assertEqual(admit_times, sorted(admit_times))

    def test_source_label(self):
        data = generate_mock_mimic_demo(n_patients=2)
        for traj in data:
            self.assertEqual(traj.source, "mock_mimic_iv")

    def test_icd_codes_nonempty(self):
        data = generate_mock_mimic_demo(n_patients=5)
        for traj in data:
            for visit in traj.visits:
                self.assertGreater(len(visit.icd_codes), 0)

    def test_ndc_in_formulary(self):
        formulary_ndcs = set(_FORMULARY_NDC_MAP.keys())
        data = generate_mock_mimic_demo(n_patients=10)
        for traj in data:
            for visit in traj.visits:
                for ndc in visit.drugs_ndc:
                    self.assertIn(ndc, formulary_ndcs)


class TestLegacyCSVLoader(unittest.TestCase):
    """Test the LegacyCSVLoader with a synthetic CSV."""

    def setUp(self):
        """Create a minimal synthetic CSV that mimics medical_data_final_15000.csv."""
        self.csv_path = Path(_BACKEND_DIR) / "src" / "tests" / "_test_legacy.csv"
        rows = [
            {
                "sym_hypertension": 1, "sym_heart_failure": 0, "sym_edema": 0,
                "sym_pain": 0, "sym_inflammation": 0, "sym_fever": 0,
                "sym_acid_reflux": 0, "sym_peptic_ulcer": 0,
                "sym_type2_diabetes": 1, "sym_hyperlipidemia": 0,
                "sym_angina": 0, "sym_bacterial_infection": 0,
                "sym_pneumonia": 0, "sym_renal_impairment": 0,
                "rx_Lisinopril": 1, "rx_Metformin": 1,
                "rule": "Hypertension+T2DM",
            }
        ] * 3
        pd.DataFrame(rows).to_csv(self.csv_path, index=False)

    def tearDown(self):
        if self.csv_path.exists():
            os.remove(self.csv_path)

    def test_loads_correct_count(self):
        loader = LegacyCSVLoader(str(self.csv_path))
        data = loader.load()
        self.assertEqual(len(data), 3)

    def test_each_trajectory_is_single_visit(self):
        loader = LegacyCSVLoader(str(self.csv_path))
        data = loader.load()
        for traj in data:
            self.assertEqual(len(traj.visits), 1)

    def test_icd_codes_mapped_from_symptoms(self):
        loader = LegacyCSVLoader(str(self.csv_path))
        data = loader.load()
        first_visit = data[0].visits[0]
        # Row has hypertension=1 -> I10, type2_diabetes=1 -> E11.9
        self.assertIn("I10", first_visit.icd_codes)
        self.assertIn("E11.9", first_visit.icd_codes)


# ===========================================================================
# Clinical Mapper Tests
# ===========================================================================

class TestClinicalOntologyMapper(unittest.TestCase):
    """Unit tests for ClinicalOntologyMapper (curated vocabulary mode)."""

    def setUp(self):
        self.mapper = get_mock_mapper()

    def test_exact_match(self):
        result = self.mapper.map_symptom("hypertension")
        self.assertIsNotNone(result)
        self.assertEqual(result.icd10_code, "I10")
        self.assertEqual(result.snomed_id, "38341003")

    def test_synonym_pyrexia(self):
        """'pyrexia' must map to fever (R50.9) — replaces regex synonym dict."""
        result = self.mapper.map_symptom("pyrexia")
        self.assertIsNotNone(result)
        self.assertEqual(result.icd10_code, "R50.9")

    def test_abbreviation_gerd(self):
        result = self.mapper.map_symptom("gerd")
        self.assertIsNotNone(result)
        self.assertEqual(result.icd10_code, "K21.9")

    def test_case_insensitive(self):
        result = self.mapper.map_symptom("HYPERTENSION")
        self.assertIsNotNone(result)
        self.assertEqual(result.icd10_code, "I10")

    def test_underscore_normalisation(self):
        result = self.mapper.map_symptom("type2_diabetes")
        self.assertIsNotNone(result)
        self.assertEqual(result.icd10_code, "E11.9")

    def test_unknown_symptom_returns_none(self):
        result = self.mapper.map_symptom("xyzzy_fictional_syndrome")
        self.assertIsNone(result)

    def test_extract_icd10_set(self):
        codes = self.mapper.extract_icd10_set(["hypertension", "fever", "gerd"])
        self.assertIn("I10", codes)
        self.assertIn("R50.9", codes)
        self.assertIn("K21.9", codes)

    def test_batch_mapping(self):
        results = self.mapper.map_symptom_batch(
            ["hypertension", "unknown_thing", "pyrexia"]
        )
        self.assertIsNotNone(results["hypertension"])
        self.assertIsNone(results["unknown_thing"])
        self.assertIsNotNone(results["pyrexia"])

    def test_lca_without_dag_returns_none(self):
        """LCA should return None gracefully when DAG is not loaded."""
        result = self.mapper.lowest_common_ancestor("I10", "I50.9")
        self.assertIsNone(result)


class TestSNOMEDDAG(unittest.TestCase):
    """Tests for SNOMED CT polyhierarchy LCA traversal."""

    def setUp(self):
        import networkx as nx
        self.dag = generate_mock_snomed_dag()
        self.mapper = ClinicalOntologyMapper()
        self.mapper._snomed_dag = self.dag
        # Register ICD-10 -> SNOMED reverse lookups for mock concepts
        self.mapper._icd10_to_snomed = {
            "I10": "38341003",
            "I50.9": "84114007",
            "E11.9": "44054006",
        }

    def test_lca_hypertension_heart_failure(self):
        """Hypertension and Heart Failure should share 'Disease' as LCA."""
        lca = self.mapper.lowest_common_ancestor("I10", "I50.9")
        # Both map to SNOMED 38341003 and 84114007, LCA = 64572001 (Disease)
        self.assertEqual(lca, "64572001")


# ===========================================================================
# Drug Mapper Tests
# ===========================================================================

class TestDrugOntologyMapper(unittest.TestCase):
    """Unit tests for DrugOntologyMapper (curated fallback mode)."""

    def setUp(self):
        self.mapper = DrugOntologyMapper()

    def test_map_ndc_lisinopril(self):
        result = self.mapper.map_ndc("00071015523")
        self.assertIsNotNone(result)
        self.assertEqual(result.drug_name, "Lisinopril")
        self.assertEqual(result.rxcui, "29046")
        self.assertEqual(result.atc4, "C09AA03")
        self.assertEqual(result.atc3, "C09A")

    def test_map_all_formulary_ndcs(self):
        """All 8 formulary NDCs must resolve without error."""
        for ndc, (rxcui, name, atc4, atc3) in _FORMULARY_NDC_MAP.items():
            result = self.mapper.map_ndc(ndc)
            self.assertIsNotNone(result, f"Failed to map NDC: {ndc}")
            self.assertEqual(result.rxcui, rxcui)
            self.assertEqual(result.atc4, atc4)

    def test_ndc_normalisation(self):
        """Short NDC should be zero-padded to 11 chars."""
        result = self.mapper.map_ndc("71015523")  # Missing leading zeros
        # Should still resolve if normalised to 00071015523
        self.assertIsNotNone(result)

    def test_unknown_ndc_returns_none(self):
        result = self.mapper.map_ndc("99999999999")
        self.assertIsNone(result)

    def test_map_drug_name(self):
        result = self.mapper.map_drug_name("Metformin")
        self.assertIsNotNone(result)
        self.assertEqual(result.rxcui, "6809")
        self.assertEqual(result.atc4, "A10BA02")

    def test_map_drug_name_case_insensitive(self):
        result = self.mapper.map_drug_name("ATORVASTATIN")
        self.assertIsNotNone(result)
        self.assertEqual(result.atc3, "C10A")

    def test_get_formulary_atc_matrix(self):
        df = self.mapper.get_formulary_atc_matrix()
        self.assertEqual(len(df), 8)
        self.assertIn("Lisinopril", df.index)
        self.assertIn("atc4", df.columns)
        self.assertIn("atc3", df.columns)

    def test_map_rxcui_to_atc(self):
        atc4, atc3 = self.mapper.map_rxcui_to_atc("29046")  # Lisinopril
        self.assertEqual(atc4, "C09AA03")
        self.assertEqual(atc3, "C09A")

    def test_batch_map(self):
        ndcs = ["00071015523", "00093107001", "99999999999"]
        results = self.mapper.map_ndc_batch(ndcs)
        self.assertIsNotNone(results["00071015523"])
        self.assertIsNotNone(results["00093107001"])
        self.assertIsNone(results["99999999999"])


# ===========================================================================
# DDI Graph Builder Tests
# ===========================================================================

class TestDDIGraphBuilder(unittest.TestCase):
    """Unit tests for DDIGraphBuilder (curated mode)."""

    def setUp(self):
        self.builder = DDIGraphBuilder()
        self.builder.load_curated()

    def test_all_formulary_nodes_present(self):
        G = self.builder.get_graph()
        for drug in FORMULARY:
            self.assertIn(drug, G.nodes, f"Missing node: {drug}")

    def test_high_severity_edge_lisinopril_spironolactone(self):
        G = self.builder.get_graph()
        self.assertTrue(G.has_edge("Lisinopril", "Spironolactone"))
        edge_data = G.get_edge_data("Lisinopril", "Spironolactone")
        self.assertEqual(edge_data["severity"], "High")
        self.assertIn("Hyperkalemia", edge_data["side_effect"])

    def test_adjacency_matrix_shape(self):
        A = self.builder.get_adjacency_matrix()
        self.assertEqual(A.shape, (8, 8))

    def test_adjacency_matrix_symmetric(self):
        A = self.builder.get_adjacency_matrix()
        np.testing.assert_array_equal(A, A.T)

    def test_adjacency_matrix_no_self_loops(self):
        A = self.builder.get_adjacency_matrix()
        for i in range(len(FORMULARY)):
            self.assertEqual(A[i][i], 0)

    def test_adjacency_matrix_high_only(self):
        A_high = self.builder.get_adjacency_matrix(severity_levels=["High"])
        A_all = self.builder.get_adjacency_matrix()
        # High-only matrix must be a subset of all-severity matrix
        self.assertTrue(np.all(A_high <= A_all))
        # There must be fewer or equal non-zero entries in High-only
        self.assertLessEqual(A_high.sum(), A_all.sum())

    def test_pytorch_geometric_export(self):
        pyg = self.builder.to_pytorch_geometric()
        self.assertIn("edge_index", pyg)
        self.assertIn("edge_attr", pyg)
        edge_index = pyg["edge_index"]
        edge_attr = pyg["edge_attr"]
        # edge_index must be shape (2, E)
        self.assertEqual(edge_index.shape[0], 2)
        # edge_attr must match number of directed edges
        self.assertEqual(edge_index.shape[1], edge_attr.shape[0])

    def test_graph_summary(self):
        summary = self.builder.get_summary()
        self.assertIn("n_nodes", summary)
        self.assertIn("n_edges", summary)
        self.assertIn("edges_by_severity", summary)
        self.assertGreater(summary["n_edges"], 0)

    def test_factory_function(self):
        """build_formulary_ddi_graph should return a populated DDIGraphBuilder."""
        builder = build_formulary_ddi_graph()
        G = builder.get_graph()
        self.assertEqual(G.number_of_nodes(), 8)
        self.assertGreater(G.number_of_edges(), 0)


# ===========================================================================
# Integration test: End-to-end pipeline
# ===========================================================================

class TestEndToEndPipeline(unittest.TestCase):
    """
    Integration test: mock patient visit -> clinical mapper -> drug mapper
    -> DDI graph adjacency lookup.
    """

    def test_full_pipeline(self):
        # Step 1: Generate mock EHR data
        trajectories = generate_mock_mimic_demo(n_patients=3)
        self.assertGreater(len(trajectories), 0)

        # Step 2: Map ICD codes from symptom strings using clinical mapper
        mapper = get_mock_mapper()
        icd_set = mapper.extract_icd10_set(["hypertension", "heart_failure", "type2_diabetes"])
        self.assertIn("I10", icd_set)
        self.assertIn("I50.9", icd_set)

        # Step 3: Map NDCs from the first visit to RxCUIs + ATCs
        drug_mapper = DrugOntologyMapper()
        first_visit = trajectories[0].visits[0]
        atc_codes = []
        for ndc in first_visit.drugs_ndc:
            result = drug_mapper.map_ndc(ndc)
            if result:
                atc_codes.append(result.atc4)
        self.assertIsInstance(atc_codes, list)

        # Step 4: Check DDI adjacency matrix
        builder = build_formulary_ddi_graph()
        A = builder.get_adjacency_matrix(severity_levels=["High"])
        self.assertEqual(A.shape, (8, 8))
        # Lisinopril (0) + Spironolactone (1) must have High DDI
        self.assertEqual(A[0][1], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
