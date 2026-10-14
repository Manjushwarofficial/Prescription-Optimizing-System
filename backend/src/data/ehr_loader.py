"""
ehr_loader.py
=============
Longitudinal EHR Dataset Loaders for the AI-Based Intelligent Prescription
Optimization System (Phase 2 upgrade).

Supports:
    - MIMIC-IV (structured; hosp module CSVs from PhysioNet v2.2)
    - MIMIC-III (legacy ICD-9 codes with optional ICD-9 -> ICD-10 crosswalk)
    - eICU Collaborative Research Database (patient + diagnosis + medication)
    - Baseline legacy wrapper: medical_data_final_15000.csv (backward-compat.)

Each patient record is structured as an ordered temporal sequence of hospital
admissions V_1, V_2, ..., V_t, where each visit V_i contains:
    - icd_codes   : frozenset of ICD-10 diagnosis codes
    - procedures  : frozenset of ICD-10 procedure codes
    - drugs_ndc   : list of National Drug Codes (NDC, 11-digit)
    - lab_flags   : dict of {test_name: flag_str} (optional)

Open Demo Data (no credentials required):
    wget -r -N -c -np https://physionet.org/files/mimic-iv-demo/2.2/ -P data/mimic-iv-demo/
    Specifically: hosp/admissions.csv.gz, hosp/diagnoses_icd.csv.gz,
                  hosp/procedures_icd.csv.gz, hosp/prescriptions.csv.gz,
                  hosp/labevents.csv.gz

References:
    - MIMIC-IV schema: https://mimic.mit.edu/docs/iv/
    - PhysioNet demo (100 patients, no credentials):
      https://physionet.org/files/mimic-iv-demo/2.2/
    - eICU CRD: https://eicu-crd.mit.edu/
"""

from __future__ import annotations

import gzip
import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, FrozenSet, Iterator, List, Optional

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Core data structures
# ---------------------------------------------------------------------------

@dataclass
class VisitRecord:
    """
    One hospital admission (visit) for a single patient.

    Attributes
    ----------
    hadm_id    : Hospital admission ID (from MIMIC-IV hosp/admissions.csv)
    admittime  : Admission datetime
    dischtime  : Discharge datetime
    icd_codes  : Frozenset of ICD-10-CM / ICD-9-CM diagnosis codes
    procedures : Frozenset of ICD-10-PCS / ICD-9-CM procedure codes
    drugs_ndc  : List of 11-digit National Drug Codes prescribed this visit
    lab_flags  : Optional abnormal-flag annotations from labevents
    """
    hadm_id: int
    admittime: pd.Timestamp
    dischtime: pd.Timestamp
    icd_codes: FrozenSet[str] = field(default_factory=frozenset)
    procedures: FrozenSet[str] = field(default_factory=frozenset)
    drugs_ndc: List[str] = field(default_factory=list)
    lab_flags: Dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hadm_id": self.hadm_id,
            "admittime": str(self.admittime),
            "dischtime": str(self.dischtime),
            "icd_codes": sorted(self.icd_codes),
            "procedures": sorted(self.procedures),
            "drugs_ndc": self.drugs_ndc,
            "lab_flags": self.lab_flags,
        }


@dataclass
class PatientTrajectory:
    """
    Ordered longitudinal sequence of hospital visits for one patient.

    Attributes
    ----------
    subject_id : Patient identifier (MIMIC-IV subject_id)
    visits     : Chronologically-sorted list of VisitRecord objects
    source     : Name of the dataset this trajectory came from
    """
    subject_id: int
    visits: List[VisitRecord]
    source: str = "unknown"

    def __len__(self) -> int:
        return len(self.visits)

    def __iter__(self) -> Iterator[VisitRecord]:
        return iter(self.visits)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "subject_id": self.subject_id,
            "source": self.source,
            "n_visits": len(self.visits),
            "visits": [v.to_dict() for v in self.visits],
        }


# ---------------------------------------------------------------------------
# Base loader interface
# ---------------------------------------------------------------------------

class BaseEHRLoader:
    """Abstract base class for all EHR dataset loaders."""

    def load(self) -> List[PatientTrajectory]:
        raise NotImplementedError

    def _read_csv_gz(self, path: Path, **kwargs) -> pd.DataFrame:
        """Read a plain CSV or gzip-compressed CSV transparently."""
        if not path.exists():
            raise FileNotFoundError(f"Expected data file not found: {path}")
        if path.suffix == ".gz":
            with gzip.open(path, "rt") as fh:
                return pd.read_csv(fh, **kwargs)
        return pd.read_csv(path, **kwargs)


# ---------------------------------------------------------------------------
# MIMIC-IV Loader
# ---------------------------------------------------------------------------

class MIMICIVLoader(BaseEHRLoader):
    """
    Longitudinal EHR loader for MIMIC-IV (PhysioNet v2.2).

    Expected directory layout (hosp module):
        <data_dir>/hosp/admissions.csv[.gz]
        <data_dir>/hosp/diagnoses_icd.csv[.gz]
        <data_dir>/hosp/procedures_icd.csv[.gz]
        <data_dir>/hosp/prescriptions.csv[.gz]
        <data_dir>/hosp/labevents.csv[.gz]      (optional; very large)

    Relational schema (MIMIC-IV v2.2):
        admissions      : subject_id, hadm_id, admittime, dischtime
        diagnoses_icd   : subject_id, hadm_id, seq_num, icd_code, icd_version
        procedures_icd  : subject_id, hadm_id, seq_num, icd_code, icd_version
        prescriptions   : subject_id, hadm_id, starttime, drug, ndc (11-digit)

    Grouping logic:
        Group by subject_id -> sort by admittime -> aggregate
        {diagnoses_icd, procedures_icd, prescriptions} per hadm_id -> V_1..V_t
    """

    _ADMISSIONS_COLS = ["subject_id", "hadm_id", "admittime", "dischtime"]
    _DIAGNOSES_COLS = ["subject_id", "hadm_id", "seq_num", "icd_code", "icd_version"]
    _PROCEDURES_COLS = ["subject_id", "hadm_id", "seq_num", "icd_code", "icd_version"]
    _PRESCRIPTIONS_COLS = ["subject_id", "hadm_id", "starttime", "drug", "ndc"]
    _LABEVENTS_COLS = ["subject_id", "hadm_id", "itemid", "flag"]

    def __init__(
        self,
        data_dir: str,
        load_labs: bool = False,
        icd9_to_icd10_map: Optional[Dict[str, str]] = None,
        max_patients: Optional[int] = None,
    ):
        """
        Parameters
        ----------
        data_dir          : Root directory containing the 'hosp/' sub-folder.
        load_labs         : If True, also load labevents (slow for full MIMIC-IV).
        icd9_to_icd10_map : Optional crosswalk dict {icd9_code: icd10_code} to
                            unify legacy ICD-9 entries into ICD-10 space.
        max_patients      : If set, cap the number of patients loaded (for testing).
        """
        self.data_dir = Path(data_dir)
        self.load_labs = load_labs
        self.icd9_map: Dict[str, str] = icd9_to_icd10_map or {}
        self.max_patients = max_patients

    # ------------------------------------------------------------------
    # File resolver
    # ------------------------------------------------------------------

    def _hosp(self, filename: str) -> Path:
        """Return path to a hosp-module file (supports .csv and .csv.gz)."""
        base = self.data_dir / "hosp" / filename
        if base.exists():
            return base
        gz = self.data_dir / "hosp" / (filename + ".gz")
        if gz.exists():
            return gz
        raise FileNotFoundError(
            f"Cannot find '{filename}[.gz]' inside {self.data_dir / 'hosp'}\n"
            "Download the MIMIC-IV demo: "
            "https://physionet.org/files/mimic-iv-demo/2.2/"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def load(self) -> List[PatientTrajectory]:
        """
        Load MIMIC-IV hosp tables and construct longitudinal patient trajectories.

        Returns
        -------
        List[PatientTrajectory] sorted by subject_id, visits chronologically
        ordered by admittime.
        """
        logger.info("[MIMICIVLoader] Loading admissions ...")
        admissions = self._read_csv_gz(
            self._hosp("admissions.csv"),
            usecols=self._ADMISSIONS_COLS,
            parse_dates=["admittime", "dischtime"],
        )

        logger.info("[MIMICIVLoader] Loading diagnoses_icd ...")
        diagnoses = self._read_csv_gz(
            self._hosp("diagnoses_icd.csv"),
            usecols=self._DIAGNOSES_COLS,
            dtype={"icd_code": str, "icd_version": "Int64"},
        )

        logger.info("[MIMICIVLoader] Loading procedures_icd ...")
        procedures = self._read_csv_gz(
            self._hosp("procedures_icd.csv"),
            usecols=self._PROCEDURES_COLS,
            dtype={"icd_code": str, "icd_version": "Int64"},
        )

        logger.info("[MIMICIVLoader] Loading prescriptions ...")
        prescriptions = self._read_csv_gz(
            self._hosp("prescriptions.csv"),
            usecols=self._PRESCRIPTIONS_COLS,
            dtype={"ndc": str},
        )

        lab_map: Dict[int, Dict[str, str]] = {}
        if self.load_labs:
            logger.info("[MIMICIVLoader] Loading labevents (may be large) ...")
            labs = self._read_csv_gz(
                self._hosp("labevents.csv"),
                usecols=self._LABEVENTS_COLS,
            )
            lab_map = self._build_lab_map(labs)

        return self._build_trajectories(
            admissions, diagnoses, procedures, prescriptions, lab_map
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _normalise_icd(self, code: str, version: int) -> str:
        """
        Normalise ICD code: if version == 9, attempt crosswalk to ICD-10.
        Prefixes unmatched ICD-9 codes with 'ICD9_' to keep them distinguishable.
        """
        code = str(code).strip()
        if version == 10:
            return code
        mapped = self.icd9_map.get(code)
        return mapped if mapped else f"ICD9_{code}"

    def _build_lab_map(
        self, labs: pd.DataFrame
    ) -> Dict[int, Dict[str, str]]:
        """Build {hadm_id -> {str(itemid): flag}} for abnormal lab annotations."""
        labs = labs.dropna(subset=["flag"])
        result: Dict[int, Dict[str, str]] = {}
        for hadm_id, grp in labs.groupby("hadm_id"):
            result[int(hadm_id)] = {
                str(r["itemid"]): str(r["flag"]) for _, r in grp.iterrows()
            }
        return result

    def _build_trajectories(
        self,
        admissions: pd.DataFrame,
        diagnoses: pd.DataFrame,
        procedures: pd.DataFrame,
        prescriptions: pd.DataFrame,
        lab_map: Dict[int, Dict[str, str]],
    ) -> List[PatientTrajectory]:
        """Group rows by subject_id -> sort by admittime -> build VisitRecord objects."""

        # Aggregate ICD codes per hadm_id
        def _agg_icd(df: pd.DataFrame) -> FrozenSet[str]:
            return frozenset(
                self._normalise_icd(r["icd_code"], int(r.get("icd_version", 10) or 10))
                for _, r in df.iterrows()
            )

        diag_grouped: Dict[int, FrozenSet[str]] = {
            int(hid): _agg_icd(grp)
            for hid, grp in diagnoses.groupby("hadm_id")
        }
        proc_grouped: Dict[int, FrozenSet[str]] = {
            int(hid): _agg_icd(grp)
            for hid, grp in procedures.groupby("hadm_id")
        }

        # Aggregate NDCs per hadm_id (drop NaN, keep 11-char strings)
        ndc_grouped: Dict[int, List[str]] = {
            int(hid): [
                str(ndc).zfill(11)[:11]
                for ndc in grp["ndc"].dropna().tolist()
                if str(ndc).strip() not in ("", "nan")
            ]
            for hid, grp in prescriptions.groupby("hadm_id")
        }

        trajectories: List[PatientTrajectory] = []
        subject_ids = admissions["subject_id"].unique()
        if self.max_patients is not None:
            subject_ids = subject_ids[: self.max_patients]

        for subject_id in subject_ids:
            pt_adm = (
                admissions[admissions["subject_id"] == subject_id]
                .sort_values("admittime")
                .reset_index(drop=True)
            )
            visits: List[VisitRecord] = []
            for _, row in pt_adm.iterrows():
                hid = int(row["hadm_id"])
                visits.append(
                    VisitRecord(
                        hadm_id=hid,
                        admittime=row["admittime"],
                        dischtime=row["dischtime"],
                        icd_codes=diag_grouped.get(hid, frozenset()),
                        procedures=proc_grouped.get(hid, frozenset()),
                        drugs_ndc=ndc_grouped.get(hid, []),
                        lab_flags=lab_map.get(hid, {}),
                    )
                )
            if visits:
                trajectories.append(
                    PatientTrajectory(
                        subject_id=int(subject_id),
                        visits=visits,
                        source="MIMIC-IV",
                    )
                )

        logger.info(
            "[MIMICIVLoader] Loaded %d patients, %d total admissions.",
            len(trajectories),
            sum(len(t) for t in trajectories),
        )
        return trajectories


# ---------------------------------------------------------------------------
# MIMIC-III Loader (legacy ICD-9 codes)
# ---------------------------------------------------------------------------

class MIMICIIILoader(MIMICIVLoader):
    """
    Loader for MIMIC-III (ICD-9-CM codes). Subclasses MIMICIVLoader and
    overrides file-resolution to match MIMIC-III's uppercase, flat-directory
    layout. All ICD-9 codes are prefixed 'ICD9_' unless a crosswalk is provided.

    Expected layout:
        <data_dir>/ADMISSIONS.csv[.gz]
        <data_dir>/DIAGNOSES_ICD.csv[.gz]
        <data_dir>/PROCEDURES_ICD.csv[.gz]
        <data_dir>/PRESCRIPTIONS.csv[.gz]
    """

    _DIAG3_COLS = ["SUBJECT_ID", "HADM_ID", "SEQ_NUM", "ICD9_CODE"]
    _PROC3_COLS = ["SUBJECT_ID", "HADM_ID", "SEQ_NUM", "ICD9_CODE"]
    _PRESC3_COLS = ["SUBJECT_ID", "HADM_ID", "STARTDATE", "DRUG", "NDC"]

    def _hosp(self, filename: str) -> Path:
        """MIMIC-III files live in the root data_dir, not a hosp/ subfolder."""
        upper = filename.upper()
        for variant in [upper, upper + ".gz"]:
            p = self.data_dir / variant
            if p.exists():
                return p
        raise FileNotFoundError(
            f"Cannot find '{upper}[.gz]' in {self.data_dir}"
        )

    def load(self) -> List[PatientTrajectory]:
        admissions = self._read_csv_gz(
            self._hosp("ADMISSIONS.csv"),
            usecols=["SUBJECT_ID", "HADM_ID", "ADMITTIME", "DISCHTIME"],
            parse_dates=["ADMITTIME", "DISCHTIME"],
        )
        admissions.columns = admissions.columns.str.lower()

        diag_raw = self._read_csv_gz(
            self._hosp("DIAGNOSES_ICD.csv"),
            usecols=self._DIAG3_COLS,
            dtype={"ICD9_CODE": str},
        )
        diag_raw.columns = diag_raw.columns.str.lower()
        diag_raw["icd_version"] = 9
        diag_raw = diag_raw.rename(columns={"icd9_code": "icd_code"})

        proc_raw = self._read_csv_gz(
            self._hosp("PROCEDURES_ICD.csv"),
            usecols=self._PROC3_COLS,
            dtype={"ICD9_CODE": str},
        )
        proc_raw.columns = proc_raw.columns.str.lower()
        proc_raw["icd_version"] = 9
        proc_raw = proc_raw.rename(columns={"icd9_code": "icd_code"})

        presc_raw = self._read_csv_gz(
            self._hosp("PRESCRIPTIONS.csv"),
            usecols=self._PRESC3_COLS,
            dtype={"NDC": str},
        )
        presc_raw.columns = presc_raw.columns.str.lower()
        presc_raw = presc_raw.rename(columns={"startdate": "starttime"})

        trajectories = self._build_trajectories(
            admissions, diag_raw, proc_raw, presc_raw, {}
        )
        for t in trajectories:
            t.source = "MIMIC-III"
        return trajectories


# ---------------------------------------------------------------------------
# eICU Loader
# ---------------------------------------------------------------------------

class EICULoader(BaseEHRLoader):
    """
    Loader for the eICU Collaborative Research Database.

    Expected layout:
        <data_dir>/patient.csv[.gz]
        <data_dir>/diagnosis.csv[.gz]
        <data_dir>/medication.csv[.gz]

    Each eICU 'patientunitstayid' becomes a single VisitRecord; multiple ICU
    stays per patient are grouped by 'uniquepid' into a trajectory.

    Reference: https://eicu-crd.mit.edu/eicutables/
    """

    def __init__(self, data_dir: str, max_patients: Optional[int] = None):
        self.data_dir = Path(data_dir)
        self.max_patients = max_patients

    def _path(self, filename: str) -> Path:
        for variant in [filename, filename + ".gz"]:
            p = self.data_dir / variant
            if p.exists():
                return p
        raise FileNotFoundError(
            f"Cannot find '{filename}[.gz]' in {self.data_dir}"
        )

    def load(self) -> List[PatientTrajectory]:
        logger.info("[EICULoader] Loading patient table ...")
        patients = self._read_csv_gz(
            self._path("patient.csv"),
            usecols=[
                "patientunitstayid", "patienthealthsystemstayid",
                "hospitaladmitoffset", "hospitaldischargeoffset", "uniquepid",
            ],
        )

        logger.info("[EICULoader] Loading diagnosis table ...")
        diagnoses = self._read_csv_gz(
            self._path("diagnosis.csv"),
            usecols=["patientunitstayid", "icd9code"],
            dtype={"icd9code": str},
        )

        logger.info("[EICULoader] Loading medication table ...")
        medications = self._read_csv_gz(
            self._path("medication.csv"),
            usecols=["patientunitstayid", "drugname"],
        )

        return self._build_trajectories(patients, diagnoses, medications)

    def _build_trajectories(
        self,
        patients: pd.DataFrame,
        diagnoses: pd.DataFrame,
        medications: pd.DataFrame,
    ) -> List[PatientTrajectory]:
        diag_map: Dict[int, FrozenSet[str]] = {
            int(uid): frozenset(f"ICD9_{c.strip()}" for c in grp["icd9code"].dropna())
            for uid, grp in diagnoses.groupby("patientunitstayid")
        }
        med_map: Dict[int, List[str]] = {
            int(uid): grp["drugname"].dropna().tolist()
            for uid, grp in medications.groupby("patientunitstayid")
        }

        base = pd.Timestamp("2000-01-01")
        trajectories: List[PatientTrajectory] = []
        unique_pids = patients["uniquepid"].unique()
        if self.max_patients is not None:
            unique_pids = unique_pids[: self.max_patients]

        for pid in unique_pids:
            stays = patients[patients["uniquepid"] == pid].sort_values(
                "hospitaladmitoffset"
            )
            visits: List[VisitRecord] = []
            for _, row in stays.iterrows():
                uid = int(row["patientunitstayid"])
                admit_offset = int(row.get("hospitaladmitoffset") or 0)
                disch_offset = int(
                    row.get("hospitaldischargeoffset") or admit_offset + 1440
                )
                visits.append(
                    VisitRecord(
                        hadm_id=uid,
                        admittime=base + pd.Timedelta(minutes=admit_offset),
                        dischtime=base + pd.Timedelta(minutes=disch_offset),
                        icd_codes=diag_map.get(uid, frozenset()),
                        procedures=frozenset(),
                        drugs_ndc=[],  # eICU uses drug names, not NDCs
                        lab_flags={},
                    )
                )
            if visits:
                trajectories.append(
                    PatientTrajectory(
                        subject_id=abs(hash(str(pid))) % (10 ** 9),
                        visits=visits,
                        source="eICU",
                    )
                )

        logger.info("[EICULoader] Loaded %d patient trajectories.", len(trajectories))
        return trajectories


# ---------------------------------------------------------------------------
# Legacy backward-compatible loader
# ---------------------------------------------------------------------------

class LegacyCSVLoader(BaseEHRLoader):
    """
    Backward-compatible wrapper for medical_data_final_15000.csv (instance-based).

    Each CSV row is wrapped as a single-visit PatientTrajectory so that
    downstream longitudinal code can treat it uniformly with real EHR loaders.
    Symptom columns (sym_*) are mapped to proxy ICD-10 codes.
    """

    _SYMPTOM_ICD10_MAP: Dict[str, str] = {
        "hypertension": "I10",
        "heart_failure": "I50.9",
        "edema": "R60.9",
        "pain": "R52",
        "inflammation": "M79.3",
        "fever": "R50.9",
        "acid_reflux": "K21.9",
        "peptic_ulcer": "K27.9",
        "type2_diabetes": "E11.9",
        "hyperlipidemia": "E78.5",
        "angina": "I20.9",
        "bacterial_infection": "A49.9",
        "pneumonia": "J18.9",
        "renal_impairment": "N28.9",
    }

    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)

    def load(self) -> List[PatientTrajectory]:
        if not self.csv_path.exists():
            raise FileNotFoundError(f"Legacy CSV not found: {self.csv_path}")

        df = pd.read_csv(self.csv_path)
        sym_cols = [c for c in df.columns if c.startswith("sym_")]
        base = pd.Timestamp("2023-01-01")
        trajectories: List[PatientTrajectory] = []

        for idx, row in df.iterrows():
            active_icds = frozenset(
                self._SYMPTOM_ICD10_MAP[c[4:]]  # strip 'sym_'
                for c in sym_cols
                if row.get(c) == 1 and c[4:] in self._SYMPTOM_ICD10_MAP
            )
            visit = VisitRecord(
                hadm_id=int(idx),
                admittime=base + pd.Timedelta(days=int(idx)),
                dischtime=base + pd.Timedelta(days=int(idx), hours=4),
                icd_codes=active_icds,
                procedures=frozenset(),
                drugs_ndc=[],
                lab_flags={},
            )
            trajectories.append(
                PatientTrajectory(
                    subject_id=int(idx),
                    visits=[visit],
                    source="legacy_csv",
                )
            )

        logger.info(
            "[LegacyCSVLoader] Loaded %d trajectories from %s.",
            len(trajectories),
            self.csv_path,
        )
        return trajectories


# ---------------------------------------------------------------------------
# Mock demo data generator (no credentials required)
# ---------------------------------------------------------------------------

def generate_mock_mimic_demo(n_patients: int = 10) -> List[PatientTrajectory]:
    """
    Generate synthetic MIMIC-IV-shaped patient trajectories for unit tests
    and CI pipelines, without requiring credentialed PhysioNet access.

    Returns List[PatientTrajectory] with:
      - 2-4 visits per patient (chronologically spaced 60-365 days apart)
      - Random ICD-10 codes drawn from a clinically representative pool
      - NDCs matching the 8-drug formulary defined in dataset_builder.py

    This mock data lets Phase 2 modules be tested end-to-end immediately
    while PhysioNet credentialed downloads are being finalised.
    """
    rng = np.random.default_rng(42)
    BASE = pd.Timestamp("2020-01-01")

    ICD10_POOL = [
        "I10", "I50.9", "E11.9", "E78.5", "I20.9",
        "K21.9", "J18.9", "A49.9", "R60.9", "N28.9",
    ]
    # 11-digit NDCs for the 8 formulary drugs
    NDC_POOL = [
        "00071015523",  # Lisinopril 10mg
        "00025134001",  # Spironolactone 25mg
        "00573018116",  # Ibuprofen 400mg
        "00603388821",  # Omeprazole 20mg
        "00093107001",  # Metformin 500mg
        "00071015401",  # Atorvastatin 10mg
        "00069153041",  # Amlodipine 5mg
        "00093226201",  # Amoxicillin 500mg
    ]

    trajectories: List[PatientTrajectory] = []
    for subject_id in range(1, n_patients + 1):
        n_visits = int(rng.integers(2, 5))
        visits: List[VisitRecord] = []
        admit_day = 0
        for v_idx in range(n_visits):
            n_diag = int(rng.integers(1, 5))
            n_drugs = int(rng.integers(1, 4))
            stay_hours = int(rng.integers(24, 120))
            admit_ts = BASE + pd.Timedelta(days=admit_day)
            visits.append(
                VisitRecord(
                    hadm_id=subject_id * 100 + v_idx,
                    admittime=admit_ts,
                    dischtime=admit_ts + pd.Timedelta(hours=stay_hours),
                    icd_codes=frozenset(
                        rng.choice(ICD10_POOL, size=min(n_diag, len(ICD10_POOL)), replace=False).tolist()
                    ),
                    procedures=frozenset(),
                    drugs_ndc=rng.choice(
                        NDC_POOL, size=min(n_drugs, len(NDC_POOL)), replace=False
                    ).tolist(),
                    lab_flags={},
                )
            )
            admit_day += int(rng.integers(60, 365))

        trajectories.append(
            PatientTrajectory(
                subject_id=subject_id,
                visits=visits,
                source="mock_mimic_iv",
            )
        )

    return trajectories
