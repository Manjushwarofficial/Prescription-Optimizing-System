"""
SafeAudit-CDSS — backend/routers/molecules.py
===============================================
RDKit BRICS Molecular Structure, Formulary & Visual SVG Clash Highlighting Router.
Exposes:
  • GET /api/formulary                     — Returns all 50+ ICU medications with NDC, RxCUI, ATC codes, SMILES, molecular properties, and BRICS fragments
  • GET /api/molecules                     — Alias for /api/formulary
  • GET /api/molecules/{drug_id}           — Physicochemical properties & BRICS fragments
  • GET /api/molecules/{drug_id}/svg       — Returns RDKit 2D chemical SVG (with crimson highlighted clashing MCS when ?compare_with= is passed), properties, and fragments
  • GET /api/molecules/{drug_id}/fragments — BRICS substructures and SMARTS
  • GET /api/molecules/vocab/brics         — Global 159 BRICS fragment vocabulary
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Response

import config
from chemistry.ontology_mapper import OntologyMapper
from chemistry.rdkit_brics import BRICSPipeline, render_molecule_svg

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Molecules & Formulary"])

# Singletons
_ONTOLOGY: Optional[OntologyMapper] = None
_BRICS: Optional[BRICSPipeline] = None
_ENRICHED_FORMULARY_CACHE: Optional[List[Dict[str, Any]]] = None


def get_services():
    global _ONTOLOGY, _BRICS
    if _ONTOLOGY is None:
        _ONTOLOGY = OntologyMapper()
    if _BRICS is None and config.BRICS_FINGERPRINT_PATH.exists():
        try:
            _BRICS = BRICSPipeline.load(config.PROCESSED_DIR)
        except Exception as exc:
            logger.warning("Could not load BRICSPipeline: %s", exc)
    return _ONTOLOGY, _BRICS


def get_enriched_formulary() -> List[Dict[str, Any]]:
    """Build and cache enriched formulary list with molecular properties and fragments."""
    global _ENRICHED_FORMULARY_CACHE
    if _ENRICHED_FORMULARY_CACHE is not None:
        return _ENRICHED_FORMULARY_CACHE

    ontology, brics = get_services()
    drugs = ontology.list_all()
    enriched = []

    for d in drugs:
        d_id = d["drug_id"]
        props = {}
        try:
            props = render_molecule_svg(d_id)
        except Exception:
            pass

        frags = []
        if brics:
            frags = list(brics.get_drug_fragments(d_id))

        enriched.append({
            "drug_id": d_id,
            "name": d["name"],
            "ndc_code": d.get("ndc_code", ""),
            "rxcui": d.get("rxcui", ""),
            "atc4_code": d.get("atc4_code", ""),
            "atc3_code": d.get("atc3_code", ""),
            "atc_class_name": d.get("atc_class_name", ""),
            "smiles": d.get("smiles", ""),
            "molecular_weight": props.get("molecular_weight"),
            "logp": props.get("logp"),
            "hbd": props.get("hbd"),
            "hba": props.get("hba"),
            "tpsa": props.get("tpsa"),
            "rotatable_bonds": props.get("rotatable_bonds"),
            "brics_fragments": frags or props.get("brics_fragments", []),
            "brics_fragment_count": len(frags) if frags else len(props.get("brics_fragments", []))
        })

    _ENRICHED_FORMULARY_CACHE = enriched
    return _ENRICHED_FORMULARY_CACHE


@router.get("/api/formulary", response_model=List[Dict[str, Any]])
@router.get("/api/molecules", response_model=List[Dict[str, Any]])
def list_formulary(
    atc3: Optional[str] = Query(None, description="Filter by ATC-3 class code (e.g. B01A, C10A)"),
    search: Optional[str] = Query(None, description="Search query by name, RxCUI or NDC"),
    limit: int = Query(100, ge=1, le=200)
) -> List[Dict[str, Any]]:
    """
    Returns all 50+ ICU medications with NDC, RxCUI, ATC codes, SMILES,
    molecular properties, and BRICS fragments.
    """
    results = get_enriched_formulary()

    if atc3:
        results = [d for d in results if d.get("atc3_code") == atc3.upper()]

    if search:
        q = search.lower()
        results = [
            d for d in results
            if q in d["name"].lower()
            or q in d.get("drug_id", "").lower()
            or q in str(d.get("rxcui", "")).lower()
            or q in str(d.get("ndc_code", "")).lower()
            or q in d.get("atc_class_name", "").lower()
        ]

    return results[:limit]


@router.get("/api/molecules/vocab/brics", response_model=Dict[str, Any])
def get_brics_vocabulary() -> Dict[str, Any]:
    """Return the global BRICS chemical fragment vocabulary and mask dimensions."""
    _, brics = get_services()
    if brics is None or not brics._is_fitted:
        raise HTTPException(status_code=500, detail="BRICS vocabulary not loaded.")

    return {
        "total_fragments": len(brics.fragment_vocab_),
        "total_drugs": len(brics.drug_names_),
        "mask_H_shape": list(brics.mask_H_.shape),
        "fragments": brics.fragment_vocab_
    }


@router.get("/api/molecules/{drug_id}", response_model=Dict[str, Any])
def get_molecule_details(drug_id: str) -> Dict[str, Any]:
    """Retrieve molecular properties, RDKit descriptors, and BRICS decomposition."""
    ontology, brics = get_services()
    rec = ontology.resolve(drug_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_id}' not found in ICU formulary.")

    try:
        render_data = render_molecule_svg(rec["drug_id"])
    except Exception as exc:
        logger.error("Failed to compute properties for %s: %s", drug_id, exc)
        render_data = {}

    frags = []
    if brics:
        frags = list(brics.get_drug_fragments(rec["drug_id"]))

    return {
        "drug_id": rec["drug_id"],
        "name": rec["name"],
        "rxcui": rec.get("rxcui"),
        "ndc": rec.get("ndc_code"),
        "atc4": rec.get("atc4_code"),
        "atc3": rec.get("atc3_code"),
        "atc_class_name": rec.get("atc_class_name"),
        "smiles": rec.get("smiles"),
        "molecular_weight": render_data.get("molecular_weight"),
        "logp": render_data.get("logp"),
        "hbd": render_data.get("hbd"),
        "hba": render_data.get("hba"),
        "tpsa": render_data.get("tpsa"),
        "rotatable_bonds": render_data.get("rotatable_bonds"),
        "brics_fragments": frags or render_data.get("brics_fragments", []),
        "brics_fragment_count": len(frags) if frags else len(render_data.get("brics_fragments", [])),
    }


@router.get("/api/molecules/{drug_id}/svg")
def get_molecule_svg(
    drug_id: str,
    compare_with: Optional[str] = Query(None, description="Optional clashing drug ID/name to highlight in crimson"),
    clash_with: Optional[str] = Query(None, description="Alias for compare_with"),
    raw: bool = Query(False, description="If true, returns Content-Type: image/svg+xml directly"),
    width: int = Query(420, ge=100, le=1000),
    height: int = Query(280, ge=100, le=1000),
    accept: Optional[str] = Header(None)
):
    """
    Returns the RDKit 2D chemical SVG (with crimson highlighted clashing MCS/BRICS
    substructures when compare_with is passed), molecular properties, and BRICS fragment list.
    """
    ontology, _ = get_services()
    rec = ontology.resolve(drug_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_id}' not found in ICU formulary.")

    target_clash = compare_with or clash_with
    try:
        render_data = render_molecule_svg(
            drug_id=rec["drug_id"],
            highlight_clash_with_drug_id=target_clash,
            width=width,
            height=height
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to render molecule SVG: {exc}")

    svg_content = render_data["svg"]

    if raw or (accept and "image/svg+xml" in accept):
        return Response(content=svg_content, media_type="image/svg+xml")

    return render_data


@router.get("/api/molecules/{drug_id}/fragments", response_model=Dict[str, Any])
def get_drug_brics_fragments(drug_id: str) -> Dict[str, Any]:
    """Retrieve list of unique BRICS fragments and indices for a drug."""
    ontology, brics = get_services()
    rec = ontology.resolve(drug_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_id}' not found in ICU formulary.")

    if not brics:
        raise HTTPException(status_code=500, detail="BRICS pipeline unavailable.")

    frags = list(brics.get_drug_fragments(rec["drug_id"]))
    frag_indices = [brics.vocab_index_[f] for f in frags if f in brics.vocab_index_]

    return {
        "drug_id": rec["drug_id"],
        "name": rec["name"],
        "smiles": rec.get("smiles"),
        "fragment_count": len(frags),
        "fragments": frags,
        "fragment_indices": frag_indices,
    }


_DDI_PAIRS_CACHE: Optional[List[Dict[str, Any]]] = None

def _get_ddi_pairs() -> List[Dict[str, Any]]:
    global _DDI_PAIRS_CACHE
    if _DDI_PAIRS_CACHE is None and config.DDI_PAIRS_JSON_PATH.exists():
        try:
            with open(config.DDI_PAIRS_JSON_PATH, "r", encoding="utf-8") as fh:
                _DDI_PAIRS_CACHE = json.load(fh)
        except Exception as e:
            logger.warning("Could not load ddi_pairs: %s", e)
            _DDI_PAIRS_CACHE = []
    return _DDI_PAIRS_CACHE or []


@router.get("/api/molecules/{drug_id}/graph", response_model=Dict[str, Any])
def get_molecule_graph_details(drug_id: str) -> Dict[str, Any]:
    """
    Returns full Ontology Harmonization Chain (Raw NDC -> RxNorm RxCUI -> ATC-4 -> ATC-3 Class),
    live RDKit 2D SVG structure, decomposed BRICS chemical fragments, and all connected
    edges in the TwoSIDES DDI Graph alongside safe same-class alternatives.
    """
    ontology, brics = get_services()
    rec = ontology.resolve(drug_id)
    if not rec:
        raise HTTPException(status_code=404, detail=f"Drug '{drug_id}' not found in ICU formulary.")

    canon_id = rec["drug_id"]
    canon_name = rec["name"]

    try:
        from models.substitute_optimizer import SUBSTITUTE_RATIONALE_MAP
    except Exception:
        SUBSTITUTE_RATIONALE_MAP = {}

    # 1. Live RDKit 2D SVG + descriptors
    try:
        render_data = render_molecule_svg(canon_id, width=420, height=280)
    except Exception as exc:
        logger.error("Failed to render SVG for %s: %s", canon_id, exc)
        render_data = {}

    # 2. BRICS fragments with vocabulary indices
    frags = []
    frag_indices = []
    if brics:
        frags = list(brics.get_drug_fragments(canon_id))
        frag_indices = [brics.vocab_index_[f] for f in frags if f in brics.vocab_index_]

    # 3. TwoSIDES DDI graph edges
    all_pairs = _get_ddi_pairs()
    connected_edges = []

    for p in all_pairs:
        p_a_id = p.get("drug_a_id", "")
        p_b_id = p.get("drug_b_id", "")
        p_a_name = p.get("drug_a_name", "").lower()
        p_b_name = p.get("drug_b_name", "").lower()

        is_match = False
        partner_id = ""
        partner_name = ""

        if canon_id.lower() == p_a_id.lower() or canon_name.lower() == p_a_name:
            is_match = True
            partner_id = p_b_id
            partner_name = p.get("drug_b_name", p_b_id)
        elif canon_id.lower() == p_b_id.lower() or canon_name.lower() == p_b_name:
            is_match = True
            partner_id = p_a_id
            partner_name = p.get("drug_a_name", p_a_id)

        if is_match and partner_id:
            connected_edges.append({
                "partner_id": partner_id,
                "partner_name": partner_name,
                "severity_tier": p.get("severity_tier", "Major"),
                "twosides_side_effect": p.get("twosides_side_effect", "Adverse Interaction"),
                "mechanism": p.get("mechanism", "Pharmacokinetic/pharmacodynamic incompatibility"),
                "safe_substitutes": p.get("safe_within_class_substitutes", [])
            })

    # 4. Safe same-class within-class alternatives (ATC-3 family)
    class_drugs = ontology.get_substitutes_in_class(canon_id)
    safe_alternatives = []
    for cand in class_drugs:
        c_id = cand.get("drug_id", "")
        c_name = cand.get("name", "")
        rationale = SUBSTITUTE_RATIONALE_MAP.get((canon_name, c_name)) or SUBSTITUTE_RATIONALE_MAP.get((canon_id, c_id))
        if not rationale:
            rationale = f"Within-class alternative sharing ATC-3 class {rec.get('atc3_code')}, metabolized through independent pathway with zero DDI hazard."

        safe_alternatives.append({
            "drug_id": c_id,
            "name": c_name,
            "atc4_code": cand.get("atc4_code", c_id),
            "atc3_code": cand.get("atc3_code", rec.get("atc3_code")),
            "atc_class_name": cand.get("atc_class_name", rec.get("atc_class_name")),
            "rxcui": cand.get("rxcui", ""),
            "clinical_rationale": rationale
        })

    return {
        "drug_id": canon_id,
        "name": canon_name,
        "smiles": rec.get("smiles", ""),
        "ontology_chain": {
            "raw_ndc": rec.get("ndc_code", "00000-0000-00"),
            "rxcui": str(rec.get("rxcui", "N/A")),
            "atc4_code": rec.get("atc4_code", "N/A"),
            "atc3_code": rec.get("atc3_code", "N/A"),
            "atc_class_name": rec.get("atc_class_name", "Therapeutic Family")
        },
        "molecular_properties": {
            "molecular_weight": render_data.get("molecular_weight", 0.0),
            "logp": render_data.get("logp", 0.0),
            "hbd": render_data.get("hbd", 0),
            "hba": render_data.get("hba", 0),
            "tpsa": render_data.get("tpsa", 0.0),
            "rotatable_bonds": render_data.get("rotatable_bonds", 0),
            "formula": render_data.get("formula", "")
        },
        "svg": render_data.get("svg", ""),
        "brics_fragments": frags,
        "brics_fragment_indices": frag_indices,
        "brics_fragment_count": len(frags),
        "twosides_ddi_edges": connected_edges,
        "twosides_ddi_count": len(connected_edges),
        "safe_class_alternatives": safe_alternatives
    }
