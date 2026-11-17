"""
SafeAudit-CDSS — backend/chemistry/rdkit_brics.py
==================================================
Molecular Substructure Graph & BRICS Decomposition Pipeline.
Grounded in:
  • SafeDrug: Dual Molecular Graph Encoders for Safe Drug Recommendations
    Yang et al., IJCAI 2021  (Section 3.2 — Equations 12–13)
  • BRICS decomposition: Degen et al., ChemMedChem 2008

Key Capabilities:
  1. SMILES Parsing & RDKit BRICS Fragmentation.
  2. Atom-Bond Molecular Graphs (node features + edge attributes + adjacency)
     for Message Passing Neural Networks (MPNN).
  3. Sparse Binary Bipartite Mask Matrix H in {0, 1}^(|S| x |M|)
     linking substructures S to molecules M (SafeDrug Eq. 12-13).
  4. 2D Chemical Vector Renderer: render_molecule_svg(drug_id, highlight_clash_with)
     producing publication-quality SVGs with Maximum Common Substructure (MCS)
     clash highlighting in vibrant crimson (0.92, 0.22, 0.22).
"""

from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RDKit imports with fail-safe guards
# ---------------------------------------------------------------------------
try:
    from rdkit import Chem
    from rdkit.Chem import BRICS as RDKitBRICS
    from rdkit.Chem import AllChem, DataStructs, Descriptors, rdFMCS
    from rdkit.Chem.Draw import rdMolDraw2D
    from rdkit.Chem.rdMolDescriptors import GetMorganFingerprintAsBitVect
    _RDKIT_AVAILABLE = True
except ImportError:  # pragma: no cover
    _RDKIT_AVAILABLE = False
    logger.warning("RDKit is not installed. BRICSPipeline functions will raise RuntimeError.")


# Crimson highlight color for DDI reactive clash substructures
CRIMSON_RGB: Tuple[float, float, float] = (0.92, 0.22, 0.22)


# ---------------------------------------------------------------------------
# 1. SMILES Canonicalisation & BRICS Fragmentation
# ---------------------------------------------------------------------------

def canonicalise_smiles(smiles: str) -> Optional[str]:
    """Return canonical SMILES or None if the string is invalid."""
    if not _RDKIT_AVAILABLE:
        raise RuntimeError("RDKit is required.")
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    return Chem.MolToSmiles(mol, canonical=True)


def get_brics_fragments(smiles: str, min_frag_size: int = 1) -> List[str]:
    """
    Decompose a SMILES string into BRICS fragment canonical SMILES.
    Replaces BRICS dummy labels [1*]..[16*] with generic wildcard [*].
    """
    if not _RDKIT_AVAILABLE:
        raise RuntimeError("RDKit is required.")

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return []

    try:
        raw_fragments = list(RDKitBRICS.BRICSDecompose(mol))
    except Exception as exc:  # noqa: BLE001
        logger.warning("BRICS decomposition failed for '%s': %s", smiles, exc)
        return []

    fragments: List[str] = []
    for frag_smi in raw_fragments:
        # Standardise attachment points [1*]..[16*] -> [*]
        clean_smi = frag_smi
        for i in range(1, 17):
            clean_smi = clean_smi.replace(f"[{i}*]", "[*]")

        frag_mol = Chem.MolFromSmiles(clean_smi)
        if frag_mol is None:
            continue
        if frag_mol.GetNumHeavyAtoms() < min_frag_size:
            continue
        fragments.append(Chem.MolToSmiles(frag_mol, canonical=True))

    return sorted(list(set(fragments)))


def get_morgan_fp(smiles: str, radius: int = 2, n_bits: int = 2048) -> Optional[np.ndarray]:
    """Return a 1-D numpy bool array of length `n_bits`, or None on failure."""
    if not _RDKIT_AVAILABLE:
        raise RuntimeError("RDKit is required.")

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    fp = GetMorganFingerprintAsBitVect(mol, radius=radius, nBits=n_bits)
    arr = np.zeros(n_bits, dtype=np.float32)
    DataStructs.ConvertToNumpyArray(fp, arr)
    return arr


# ---------------------------------------------------------------------------
# 2. Molecular Graph Representation for MPNN / GNN
# ---------------------------------------------------------------------------

def molecular_graph_from_smiles(smiles: str) -> Optional[Dict[str, Any]]:
    """
    Convert a SMILES string into an atom-bond molecular graph.
    Returns:
      - num_atoms: int
      - x: (N_atoms, 6) feature matrix:
           [atomic_num, degree, formal_charge, hybridization, is_aromatic, num_hs]
      - edge_index: (2, 2*N_bonds) undirected connectivity
      - edge_attr: (2*N_bonds, 3) [bond_type, is_conjugated, is_in_ring]
      - adj_matrix: (N_atoms, N_atoms) binary adjacency matrix
    """
    if not _RDKIT_AVAILABLE:
        raise RuntimeError("RDKit is required.")

    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None

    num_atoms = mol.GetNumAtoms()
    hyb_map = {
        Chem.rdchem.HybridizationType.SP: 1,
        Chem.rdchem.HybridizationType.SP2: 2,
        Chem.rdchem.HybridizationType.SP3: 3,
        Chem.rdchem.HybridizationType.SP3D: 4,
        Chem.rdchem.HybridizationType.SP3D2: 5,
    }

    node_features: List[List[float]] = []
    for atom in mol.GetAtoms():
        node_features.append([
            float(atom.GetAtomicNum()),
            float(atom.GetDegree()),
            float(atom.GetFormalCharge()),
            float(hyb_map.get(atom.GetHybridization(), 0)),
            1.0 if atom.GetIsAromatic() else 0.0,
            float(atom.GetTotalNumHs())
        ])
    x = np.array(node_features, dtype=np.float32)

    adj = np.zeros((num_atoms, num_atoms), dtype=np.float32)
    edge_index: List[List[int]] = []
    edge_attr: List[List[float]] = []

    bond_type_map = {
        Chem.rdchem.BondType.SINGLE: 1.0,
        Chem.rdchem.BondType.DOUBLE: 2.0,
        Chem.rdchem.BondType.TRIPLE: 3.0,
        Chem.rdchem.BondType.AROMATIC: 4.0,
    }

    for bond in mol.GetBonds():
        i = bond.GetBeginAtomIdx()
        j = bond.GetEndAtomIdx()
        bt = bond_type_map.get(bond.GetBondType(), 1.0)
        conj = 1.0 if bond.GetIsConjugated() else 0.0
        ring = 1.0 if bond.IsInRing() else 0.0

        # Undirected edges
        edge_index.append([i, j])
        edge_attr.append([bt, conj, ring])
        edge_index.append([j, i])
        edge_attr.append([bt, conj, ring])

        adj[i, j] = 1.0
        adj[j, i] = 1.0

    if edge_index:
        ei_arr = np.array(edge_index, dtype=np.int64).T
        ea_arr = np.array(edge_attr, dtype=np.float32)
    else:
        ei_arr = np.zeros((2, 0), dtype=np.int64)
        ea_arr = np.zeros((0, 3), dtype=np.float32)

    return {
        "num_atoms": num_atoms,
        "x": x,
        "edge_index": ei_arr,
        "edge_attr": ea_arr,
        "adj_matrix": adj
    }


# ---------------------------------------------------------------------------
# 3. SafeDrug BRICS Pipeline & Incidence Mask Matrix H
# ---------------------------------------------------------------------------

class BRICSPipeline:
    """
    SafeDrug Dual Substructure Encoder & Bipartite Mask Builder.

    Builds:
      - Fragment vocabulary S across all formulary drugs M
      - Binary bipartite mask matrix H in {0, 1}^(|S| x |M|) (SafeDrug Eq. 12-13)
      - Atom-bond molecular graph features for MPNN layers
      - Tanimoto substructure similarity matrix
    """

    def __init__(
        self,
        min_frag_size: int = 1,
        morgan_radius: int = 2,
        morgan_nbits: int = 2048,
        tanimoto_threshold: float = 0.75,
    ) -> None:
        if not _RDKIT_AVAILABLE:
            raise RuntimeError("RDKit is required.")

        self.min_frag_size = min_frag_size
        self.morgan_radius = morgan_radius
        self.morgan_nbits = morgan_nbits
        self.tanimoto_threshold = tanimoto_threshold

        self.fragment_vocab_: List[str] = []
        self.vocab_index_: Dict[str, int] = {}
        self.drug_fragments_: Dict[str, List[str]] = {}
        self.fingerprints_: Dict[str, np.ndarray] = {}
        self.morgan_fps_: Dict[str, np.ndarray] = {}
        self.molecular_graphs_: Dict[str, Dict[str, Any]] = {}
        self.mask_H_: Optional[np.ndarray] = None  # (|S| x |M|)
        self.drug_names_: List[str] = []
        self.drug_ids_: List[str] = []
        self.failed_drugs_: List[str] = []
        self._is_fitted: bool = False

    def fit(
        self,
        drug_smiles: Dict[str, str],
        drug_ids: Optional[Dict[str, str]] = None
    ) -> "BRICSPipeline":
        """
        Fit BRICSPipeline over drug_smiles dict {drug_name: smiles}.
        Constructs the bipartite mask matrix H in {0, 1}^(|S| x |M|).
        """
        logger.info("BRICSPipeline.fit() — decomposing %d drugs into BRICS substructures", len(drug_smiles))
        all_fragments: set[str] = set()
        self.drug_names_ = sorted(drug_smiles.keys())

        # Pass 1: Extract fragments and graphs
        for drug in self.drug_names_:
            smiles = drug_smiles[drug]
            frags = get_brics_fragments(smiles, self.min_frag_size)
            if not frags:
                canon = canonicalise_smiles(smiles)
                if canon:
                    frags = [canon]
                else:
                    logger.warning("Unparseable SMILES for %s", drug)
                    self.failed_drugs_.append(drug)
                    continue

            self.drug_fragments_[drug] = frags
            all_fragments.update(frags)

            # Morgan Fingerprints
            mfp = get_morgan_fp(smiles, self.morgan_radius, self.morgan_nbits)
            if mfp is not None:
                self.morgan_fps_[drug] = mfp

            # Molecular graphs for MPNN
            mg = molecular_graph_from_smiles(smiles)
            if mg is not None:
                self.molecular_graphs_[drug] = mg

        # Sort vocabulary for reproducibility
        self.fragment_vocab_ = sorted(all_fragments)
        self.vocab_index_ = {f: i for i, f in enumerate(self.fragment_vocab_)}
        num_frags = len(self.fragment_vocab_)
        num_drugs = len(self.drug_names_)
        logger.info("Fragment vocabulary |S|: %d unique BRICS motifs across |M|: %d drugs", num_frags, num_drugs)

        # Pass 2: Build bipartite incidence mask matrix H in {0, 1}^(|S| x |M|)
        # SafeDrug Eq. 12-13: H_{s, m} = 1 if molecule m contains substructure s
        self.mask_H_ = np.zeros((num_frags, num_drugs), dtype=np.float32)

        for m_idx, drug in enumerate(self.drug_names_):
            fp = np.zeros(num_frags, dtype=np.float32)
            for frag in self.drug_fragments_.get(drug, []):
                if frag in self.vocab_index_:
                    s_idx = self.vocab_index_[frag]
                    fp[s_idx] = 1.0
                    self.mask_H_[s_idx, m_idx] = 1.0
            self.fingerprints_[drug] = fp

        if drug_ids:
            self.drug_ids_ = [drug_ids.get(d, "") for d in self.drug_names_]
        else:
            self.drug_ids_ = list(self.drug_names_)

        self._is_fitted = True
        logger.info("BRICSPipeline fitted: H shape (%d, %d), non-zero density: %.2f%%",
                    self.mask_H_.shape[0], self.mask_H_.shape[1],
                    (self.mask_H_.sum() / (num_frags * num_drugs)) * 100.0)
        return self

    def tanimoto_matrix(self) -> Tuple[np.ndarray, List[str]]:
        """Compute pairwise Tanimoto similarity over BRICS fingerprints."""
        self._check_fitted()
        fps = np.stack([self.fingerprints_[d] for d in self.drug_names_], axis=0)
        intersection = fps @ fps.T
        norms = fps.sum(axis=1, keepdims=True)
        union = norms + norms.T - intersection
        with np.errstate(divide="ignore", invalid="ignore"):
            sim = np.where(union == 0, 0.0, intersection / union)
        return sim.astype(np.float32), list(self.drug_names_)

    def high_similarity_pairs(self) -> pd.DataFrame:
        """Find drug pairs exceeding the Tanimoto similarity threshold."""
        matrix, drugs = self.tanimoto_matrix()
        n = len(drugs)
        rows = []
        for i in range(n):
            for j in range(i + 1, n):
                val = float(matrix[i, j])
                if val >= self.tanimoto_threshold:
                    rows.append({
                        "drug_a": drugs[i],
                        "drug_b": drugs[j],
                        "tanimoto_similarity": round(val, 4)
                    })
        return pd.DataFrame(rows).sort_values("tanimoto_similarity", ascending=False).reset_index(drop=True)

    def save(self, out_dir: Union[str, Path]) -> None:
        """Persist BRICS fingerprints and bipartite mask matrix H."""
        self._check_fitted()
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)

        # 1. Main pipeline payload
        payload = {
            "fragment_vocab": self.fragment_vocab_,
            "vocab_index": self.vocab_index_,
            "fingerprints": self.fingerprints_,
            "morgan_fps": self.morgan_fps_,
            "molecular_graphs": self.molecular_graphs_,
            "mask_H": self.mask_H_,
            "drug_names": self.drug_names_,
            "drug_ids": self.drug_ids_,
            "config": {
                "min_frag_size": self.min_frag_size,
                "morgan_radius": self.morgan_radius,
                "morgan_nbits": self.morgan_nbits,
                "tanimoto_threshold": self.tanimoto_threshold
            }
        }
        fp_path = out_dir / "brics_fingerprints.pkl"
        with open(fp_path, "wb") as fh:
            pickle.dump(payload, fh, protocol=pickle.HIGHEST_PROTOCOL)

        # 2. Dedicated SafeDrug Bipartite Mask H (brics_mask_H.pkl)
        mask_payload = {
            "H": self.mask_H_,
            "fragment_vocab": self.fragment_vocab_,
            "drug_names": self.drug_names_,
            "drug_ids": self.drug_ids_,
            "shape": self.mask_H_.shape if self.mask_H_ is not None else (0, 0)
        }
        h_path = out_dir / "brics_mask_H.pkl"
        with open(h_path, "wb") as fh:
            pickle.dump(mask_payload, fh, protocol=pickle.HIGHEST_PROTOCOL)

        logger.info("Saved brics_fingerprints.pkl and brics_mask_H.pkl -> %s", out_dir)

    @classmethod
    def load(cls, out_dir: Union[str, Path]) -> "BRICSPipeline":
        """Load a persisted BRICSPipeline."""
        fp_path = Path(out_dir) / "brics_fingerprints.pkl"
        with open(fp_path, "rb") as fh:
            payload = pickle.load(fh)

        cfg = payload["config"]
        obj = cls(
            min_frag_size=cfg["min_frag_size"],
            morgan_radius=cfg["morgan_radius"],
            morgan_nbits=cfg["morgan_nbits"],
            tanimoto_threshold=cfg["tanimoto_threshold"]
        )
        obj.fragment_vocab_ = payload["fragment_vocab"]
        obj.vocab_index_ = payload["vocab_index"]
        obj.fingerprints_ = payload["fingerprints"]
        obj.morgan_fps_ = payload["morgan_fps"]
        obj.molecular_graphs_ = payload.get("molecular_graphs", {})
        obj.mask_H_ = payload.get("mask_H")
        obj.drug_names_ = payload.get("drug_names", [])
        obj.drug_ids_ = payload.get("drug_ids", [])
        obj._is_fitted = True
        return obj

    def get_drug_fragments(self, drug_identifier: str) -> set[str]:
        """Return the set of unique BRICS fragments for a drug (by name or drug_id)."""
        if not self._is_fitted:
            return set()

        target = None
        if drug_identifier in self.fingerprints_:
            target = drug_identifier
        else:
            for d_name, d_id in zip(self.drug_names_, self.drug_ids_):
                if d_id.lower() == drug_identifier.lower() or d_name.lower() == drug_identifier.lower():
                    target = d_name
                    break

        if target and target in self.fingerprints_:
            fp = self.fingerprints_[target]
            indices = np.where(fp > 0)[0]
            return set(self.fragment_vocab_[idx] for idx in indices)

        return set()

    def _check_fitted(self) -> None:
        if not self._is_fitted:
            raise RuntimeError("BRICSPipeline is not fitted. Call fit() first.")


# ---------------------------------------------------------------------------
# 4. Publication-Quality 2D Chemical Vector Renderer with DDI Clash Highlighting
# ---------------------------------------------------------------------------

def _lookup_smiles(
    identifier: str,
    formulary_path: Optional[Path] = None
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Resolve drug_id or drug_name into (drug_id, name, smiles).
    If identifier is not in the catalogue, checks if it is a valid SMILES string.
    """
    if not _RDKIT_AVAILABLE or not identifier:
        return None, None, None

    # 1. Attempt catalogue lookup first to avoid RDKit SMILES parse warnings on ID strings
    if formulary_path is None:
        formulary_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "formulary_drugs.json"

    key = identifier.strip().lower()

    if formulary_path.exists():
        try:
            with open(formulary_path, "r", encoding="utf-8") as fh:
                catalogue = json.load(fh)

            for d in catalogue:
                if (d.get("drug_id", "").lower() == key or
                    d.get("name", "").lower() == key or
                    str(d.get("rxcui", "")).lower() == key or
                    d.get("atc4_code", "").lower() == key or
                    d.get("ndc_code", "").lower() == key):
                    return d.get("drug_id"), d.get("name"), d.get("smiles")
        except Exception as exc:  # noqa: BLE001
            logger.debug("Failed reading formulary catalogue: %s", exc)

    # 2. Check if identifier is a valid raw SMILES string (silent)
    try:
        test_mol = Chem.MolFromSmiles(identifier, sanitize=False)
        if test_mol is not None:
            return identifier, "Molecule", identifier
    except Exception:
        pass

    return None, None, None


def render_molecule_svg(
    drug_id: str,
    highlight_clash_with_drug_id: Optional[str] = None,
    formulary_path: Optional[Path] = None,
    width: int = 420,
    height: int = 280
) -> Dict[str, Any]:
    """
    Render a clean, high-resolution 2D chemical structure SVG string.

    Parameters:
      - drug_id: Drug ID, name, or SMILES string.
      - highlight_clash_with_drug_id: Optional interacting drug to compute Maximum
        Common Substructure (MCS) & shared reactive functional groups, highlighted
        in vibrant crimson ((0.92, 0.22, 0.22)).
      - formulary_path: Path to formulary_drugs.json.
      - width, height: Canvas dimensions (default 420x280).

    Returns:
      Dict with keys:
        - svg: raw XML/SVG string
        - drug_id, drug_name
        - molecular_weight, logp, hbd, hba, tpsa, rotatable_bonds
        - brics_fragments
        - clash_highlight: metadata on highlighted atoms, bonds, and shared SMARTS
    """
    if not _RDKIT_AVAILABLE:
        raise RuntimeError("RDKit is required for render_molecule_svg.")

    # 1. Resolve Primary Drug
    d_id, d_name, d_smiles = _lookup_smiles(drug_id, formulary_path)
    if d_smiles is None:
        raise ValueError(f"Could not resolve drug identifier '{drug_id}' to a valid SMILES.")

    mol = Chem.MolFromSmiles(d_smiles)
    if mol is None:
        raise ValueError(f"Failed to parse SMILES '{d_smiles}' for drug '{drug_id}'.")

    # Ensure 2D coordinates are computed
    AllChem.Compute2DCoords(mol)

    # 2. Compute Physicochemical Properties
    mol_wt = float(Descriptors.MolWt(mol))
    logp = float(Descriptors.MolLogP(mol))
    hbd = int(Descriptors.NumHDonors(mol))
    hba = int(Descriptors.NumHAcceptors(mol))
    tpsa = float(Descriptors.TPSA(mol))
    rot_bonds = int(Descriptors.NumRotatableBonds(mol))
    brics_frags = get_brics_fragments(d_smiles)

    # 3. Handle Clash Substructure Highlighting
    highlight_atoms: List[int] = []
    highlight_bonds: List[int] = []
    atom_colors: Dict[int, Tuple[float, float, float]] = {}
    bond_colors: Dict[int, Tuple[float, float, float]] = {}
    clash_metadata: Optional[Dict[str, Any]] = None

    if highlight_clash_with_drug_id:
        c_id, c_name, c_smiles = _lookup_smiles(highlight_clash_with_drug_id, formulary_path)
        if c_smiles is not None:
            clash_mol = Chem.MolFromSmiles(c_smiles)
            if clash_mol is not None:
                # Find Maximum Common Substructure (MCS)
                mcs_result = rdFMCS.FindMCS(
                    [mol, clash_mol],
                    completeRingsOnly=False,
                    ringMatchesRingOnly=True,
                    timeout=5
                )

                if mcs_result.numAtoms > 0 and mcs_result.smartsString:
                    mcs_patt = Chem.MolFromSmarts(mcs_result.smartsString)
                    if mcs_patt is not None:
                        match = mol.GetSubstructMatch(mcs_patt)
                        if match:
                            highlight_atoms = list(match)
                            # Find bonds connecting matched atoms
                            for bond in mcs_patt.GetBonds():
                                a1 = match[bond.GetBeginAtomIdx()]
                                a2 = match[bond.GetEndAtomIdx()]
                                b = mol.GetBondBetweenAtoms(a1, a2)
                                if b is not None:
                                    highlight_bonds.append(b.GetIdx())

                            atom_colors = {a: CRIMSON_RGB for a in highlight_atoms}
                            bond_colors = {b: CRIMSON_RGB for b in highlight_bonds}

                            clash_metadata = {
                                "clashing_drug_id": c_id or highlight_clash_with_drug_id,
                                "clashing_drug_name": c_name or highlight_clash_with_drug_id,
                                "shared_smarts": mcs_result.smartsString,
                                "num_shared_atoms": len(highlight_atoms),
                                "num_shared_bonds": len(highlight_bonds),
                                "highlighted_atoms": highlight_atoms,
                                "highlighted_bonds": highlight_bonds,
                                "highlight_hex": "#EB3838"
                            }

    # 4. Generate SVG via MolDraw2DSVG
    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    dopts = drawer.drawOptions()
    dopts.clearBackground = False
    dopts.bondLineWidth = 2

    rdMolDraw2D.PrepareAndDrawMolecule(
        drawer,
        mol,
        highlightAtoms=highlight_atoms,
        highlightAtomColors=atom_colors,
        highlightBonds=highlight_bonds,
        highlightBondColors=bond_colors
    )
    drawer.FinishDrawing()
    svg_text = drawer.GetDrawingText()

    return {
        "drug_id": d_id or drug_id,
        "drug_name": d_name or drug_id,
        "smiles": d_smiles,
        "svg": svg_text,
        "molecular_weight": round(mol_wt, 3),
        "logp": round(logp, 3),
        "hbd": hbd,
        "hba": hba,
        "tpsa": round(tpsa, 2),
        "rotatable_bonds": rot_bonds,
        "brics_fragments": brics_frags,
        "clash_highlight": clash_metadata
    }
