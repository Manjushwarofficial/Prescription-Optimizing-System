"""
SafeAudit-CDSS — backend/chemistry/__init__.py
===============================================
Chemistry sub-package initialisation.

Exports the two public surfaces used by all higher layers:
  • BRICSPipeline  — SMILES → BRICS fragment fingerprints (SafeDrug, IJCAI 2021)
  • OntologyMapper — RxNorm / ATC / DrugBank cross-reference resolver
"""

from .rdkit_brics import (
    BRICSPipeline,
    render_molecule_svg,
    get_brics_fragments,
    molecular_graph_from_smiles,
)  # noqa: F401
from .ontology_mapper import OntologyMapper  # noqa: F401

__all__ = [
    "BRICSPipeline",
    "render_molecule_svg",
    "get_brics_fragments",
    "molecular_graph_from_smiles",
    "OntologyMapper",
]
