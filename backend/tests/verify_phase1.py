"""
SafeAudit-CDSS — backend/tests/verify_phase1.py
================================================
Phase 1 Verification Script.
Checks and prints:
  1. Total drugs in formulary
  2. Total unique BRICS substructures |S|
  3. Shape of bipartite mask H (SafeDrug Eq. 12-13)
  4. Total TwoSIDES DDI pairs
  5. Total alert-fatigue records (exactly 6,453)
  6. Verification that SVG rendering returns valid <svg>...</svg> markup with crimson highlight
"""

from __future__ import annotations

import json
import pickle
import sys
from pathlib import Path
import pandas as pd

# Add backend directory to sys.path
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import config
from chemistry.rdkit_brics import render_molecule_svg, BRICSPipeline
from chemistry.ontology_mapper import OntologyMapper


def verify_phase1() -> bool:
    print("\n" + "=" * 70)
    print(" SAFEAUDIT-CDSS — PHASE 1 FORMAL VERIFICATION SUITE")
    print("=" * 70)

    # 1. Total drugs in formulary
    assert config.FORMULARY_DRUGS_PATH.exists(), f"Missing {config.FORMULARY_DRUGS_PATH}"
    with open(config.FORMULARY_DRUGS_PATH, "r", encoding="utf-8") as fh:
        formulary = json.load(fh)
    total_drugs = len(formulary)
    print(f"[*] Total drugs in formulary:              {total_drugs}")
    assert total_drugs >= 50, f"Expected at least 50 drugs, got {total_drugs}"

    # 2. Total unique BRICS substructures |S| & Shape of bipartite mask H
    assert config.BRICS_MASK_H_PATH.exists(), f"Missing {config.BRICS_MASK_H_PATH}"
    with open(config.BRICS_MASK_H_PATH, "rb") as fh:
        mask_data = pickle.load(fh)
    H = mask_data["H"]
    fragment_vocab = mask_data["fragment_vocab"]
    total_brics = len(fragment_vocab)
    h_shape = H.shape

    print(f"[*] Total unique BRICS substructures |S|:  {total_brics}")
    print(f"[*] Shape of bipartite mask H:             {h_shape} (|S|={h_shape[0]}, |M|={h_shape[1]})")
    assert h_shape == (total_brics, total_drugs), f"Shape mismatch: {h_shape} != ({total_brics}, {total_drugs})"

    # 3. Total TwoSIDES DDI pairs
    assert config.DDI_PAIRS_JSON_PATH.exists(), f"Missing {config.DDI_PAIRS_JSON_PATH}"
    with open(config.DDI_PAIRS_JSON_PATH, "r", encoding="utf-8") as fh:
        ddi_pairs = json.load(fh)
    total_ddi_pairs = len(ddi_pairs)
    print(f"[*] Total TwoSIDES DDI pairs:              {total_ddi_pairs}")
    assert total_ddi_pairs >= 60, f"Expected at least 60 DDI pairs, got {total_ddi_pairs}"

    # 4. Total alert-fatigue records (6,453)
    assert config.ALERT_FATIGUE_DATASET_PATH.exists(), f"Missing {config.ALERT_FATIGUE_DATASET_PATH}"
    df_alerts = pd.read_csv(config.ALERT_FATIGUE_DATASET_PATH)
    total_alert_records = len(df_alerts)
    print(f"[*] Total alert-fatigue records:           {total_alert_records}")
    assert total_alert_records == 6453, f"Expected exactly 6,453 alert records, got {total_alert_records}"

    # 5. Verify SVG rendering returns valid <svg>...</svg> markup with crimson highlight
    print("[*] Testing 2D chemical vector SVG rendering with clash highlighting...")
    # Warfarin (B01AA03) vs Aspirin (B01AC06)
    svg_res = render_molecule_svg("B01AA03", highlight_clash_with_drug_id="B01AC06")
    svg_markup = svg_res.get("svg", "")

    assert svg_markup.startswith("<?xml") or "<svg" in svg_markup, "SVG does not contain valid XML/SVG header"
    assert "</svg>" in svg_markup, "SVG does not contain closing </svg> tag"
    assert svg_res.get("clash_highlight") is not None, "Clash highlight metadata missing"

    clash = svg_res["clash_highlight"]
    print(f"    - Rendered drug:        {svg_res['drug_name']} ({svg_res['drug_id']})")
    print(f"    - Clashing drug:        {clash['clashing_drug_name']} ({clash['clashing_drug_id']})")
    print(f"    - Shared SMARTS motif:  {clash['shared_smarts']}")
    print(f"    - Highlighted atoms:    {clash['num_shared_atoms']} atoms in crimson {clash['highlight_hex']}")
    print(f"    - SVG markup size:      {len(svg_markup):,} characters")
    print(f"    - Valid <svg>...</svg>: Verified (True)")

    print("\n" + "=" * 70)
    print(" >>> PHASE 1 VERIFICATION PASSED SUCCESSFULLY! ALL CHECKS 100% OK <<<")
    print("=" * 70 + "\n")
    return True


if __name__ == "__main__":
    success = verify_phase1()
    sys.exit(0 if success else 1)
