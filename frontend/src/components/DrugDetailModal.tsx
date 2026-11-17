import React, { useState, useEffect } from 'react';
import {
  Dna,
  X,
  Plus,
  GitMerge,
  Atom,
  Copy,
  Check,
  Activity,
  Boxes,
  Share2,
  ShieldCheck,
  CheckCircle,
} from 'lucide-react';
import { MoleculeGraphDetails } from '../types';
import { fetchMoleculeGraph } from '../services/api';

interface DrugDetailModalProps {
  drugId: string | null;
  onClose: () => void;
  onPrescribe: (drugId: string) => void;
  onCompareInTab1: (drugAId: string, drugBId: string) => void;
}

export const DrugDetailModal: React.FC<DrugDetailModalProps> = ({
  drugId,
  onClose,
  onPrescribe,
  onCompareInTab1,
}) => {
  const [data, setData] = useState<MoleculeGraphDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedSmiles, setCopiedSmiles] = useState(false);

  useEffect(() => {
    if (!drugId) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchMoleculeGraph(drugId)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching drug graph:', err);
        setError(err.message || 'Failed to fetch drug details.');
        setLoading(false);
      });
  }, [drugId]);

  if (!drugId) return null;

  const handleCopySmiles = () => {
    if (!data?.smiles) return;
    navigator.clipboard.writeText(data.smiles);
    setCopiedSmiles(true);
    setTimeout(() => setCopiedSmiles(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Sticky Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Dna className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg font-bold text-white">
                  {loading ? 'Loading Entity...' : data?.name || drugId}
                </h3>
                {data && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                    {data.ontology_chain?.atc4_code || data.drug_id}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                {data
                  ? `${data.ontology_chain?.atc_class_name} [ATC-3: ${data.ontology_chain?.atc3_code}]`
                  : 'Resolving ontology chain and TwoSIDES DDI graph edges...'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {data && (
              <button
                onClick={() => {
                  onPrescribe(data.drug_id);
                  onClose();
                }}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/30 transition-all flex items-center space-x-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add to CPOE Order Pad</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 space-y-3">
              <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-mono">Decomposing BRICS fragments and rendering RDKit 2D vector graph...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800 text-rose-300 text-xs">
              {error}
            </div>
          )}

          {data && (
            <>
              {/* Section 1: Full Ontology Harmonization Chain Visualizer */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800/90 shadow-inner">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-sky-400" />
                    Ontology Harmonization Chain (CPOE Data Lineage)
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">
                    NDC ➔ RxCUI ➔ ATC-4 ➔ ATC-3
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 items-center">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-[10px] text-slate-500 block font-medium">1. RAW NDC CODE</span>
                    <span className="font-mono text-slate-200 font-bold text-xs truncate block">
                      {data.ontology_chain?.raw_ndc || '00069-3150-66'}
                    </span>
                    <span className="text-[9px] text-slate-500">Commercial Package</span>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-sky-800/50 shadow-sm">
                    <span className="text-[10px] text-sky-400 block font-medium">2. RxNorm RxCUI</span>
                    <span className="font-mono text-sky-300 font-bold text-xs truncate block">
                      {data.ontology_chain?.rxcui || '36567'}
                    </span>
                    <span className="text-[9px] text-slate-500">Clinical Ingredient ID</span>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-indigo-800/50 shadow-sm">
                    <span className="text-[10px] text-indigo-400 block font-medium">3. WHO ATC-4 CODE</span>
                    <span className="font-mono text-indigo-300 font-bold text-xs truncate block">
                      {data.ontology_chain?.atc4_code || data.drug_id}
                    </span>
                    <span className="text-[9px] text-slate-500">Chemical Substance</span>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-900 border border-emerald-800/50 shadow-sm">
                    <span className="text-[10px] text-emerald-400 block font-medium">4. ATC-3 FAMILY</span>
                    <span className="font-semibold text-emerald-300 text-xs truncate block">
                      {data.ontology_chain?.atc3_code} {data.ontology_chain?.atc_class_name}
                    </span>
                    <span className="text-[9px] text-slate-500">Therapeutic Class</span>
                  </div>
                </div>
              </div>

              {/* Section 2: Molecular 2D Structure & Descriptors */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                <div className="md:col-span-6 bg-slate-950 rounded-xl border border-slate-800 p-4 flex flex-col items-center justify-between">
                  <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-semibold flex items-center gap-1.5 text-slate-300">
                      <Atom className="w-4 h-4 text-rose-400" />
                      RDKit 2D Molecular Vector Graph
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {data.molecular_properties?.formula || 'Canonical'}
                    </span>
                  </div>

                  <div
                    className="svg-container w-full h-56 bg-slate-900/40 rounded-lg border border-slate-800/80 flex items-center justify-center p-2"
                    dangerouslySetInnerHTML={{ __html: data.svg }}
                  />

                  <div className="w-full mt-3 p-2 bg-slate-900/60 rounded-lg border border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                    <span className="truncate max-w-[280px]" title={data.smiles}>
                      {data.smiles}
                    </span>
                    <button
                      onClick={handleCopySmiles}
                      className="p-1 hover:text-sky-400 transition-colors flex items-center gap-1"
                      title="Copy SMILES"
                    >
                      {copiedSmiles ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="md:col-span-6 space-y-4">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      Physicochemical Descriptors
                    </span>
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2.5 rounded-lg bg-slate-900">
                        <span className="text-[10px] text-slate-500 block">Molecular Wt</span>
                        <span className="font-mono text-white font-bold">
                          {data.molecular_properties?.molecular_weight?.toFixed(2)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900">
                        <span className="text-[10px] text-slate-500 block">LogP</span>
                        <span className="font-mono text-sky-400 font-bold">
                          {data.molecular_properties?.logp?.toFixed(2)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900">
                        <span className="text-[10px] text-slate-500 block">TPSA (Å²)</span>
                        <span className="font-mono text-emerald-400 font-bold">
                          {data.molecular_properties?.tpsa?.toFixed(1)}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900">
                        <span className="text-[10px] text-slate-500 block">HBD</span>
                        <span className="font-mono text-slate-300 font-bold">
                          {data.molecular_properties?.hbd}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900">
                        <span className="text-[10px] text-slate-500 block">HBA</span>
                        <span className="font-mono text-slate-300 font-bold">
                          {data.molecular_properties?.hba}
                        </span>
                      </div>
                      <div className="p-2.5 rounded-lg bg-slate-900">
                        <span className="text-[10px] text-slate-500 block">Rotatable</span>
                        <span className="font-mono text-slate-300 font-bold">
                          {data.molecular_properties?.rotatable_bonds}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Boxes className="w-4 h-4 text-purple-400" />
                        BRICS Decomposition (|S| = {data.brics_fragment_count})
                      </span>
                      <span className="text-[10px] text-slate-500">SafeDrug Mask H</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
                      {data.brics_fragments?.map((f, idx) => {
                        const vocabIdx = data.brics_fragment_indices?.[idx] ?? idx;
                        return (
                          <div
                            key={idx}
                            className="px-2 py-1 rounded bg-slate-900 border border-purple-800/40 text-purple-300 font-mono text-[10px] flex items-center space-x-1.5 shadow-sm"
                          >
                            <span className="w-4 h-4 rounded bg-purple-950 flex items-center justify-center text-[9px] text-purple-400 font-bold">
                              {vocabIdx}
                            </span>
                            <span className="truncate max-w-[200px]" title={f}>
                              {f}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 3: TwoSIDES DDI Graph Connected Edges */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                    <Share2 className="w-4 h-4 text-rose-400" />
                    Connected Edges in TwoSIDES DDI Graph ({data.twosides_ddi_count} Active Links)
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    D_ij = 1 Clashes
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left text-slate-300">
                    <thead className="text-[10px] uppercase bg-slate-900 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="px-3 py-2.5">Interacting Partner Drug</th>
                        <th className="px-3 py-2.5">Severity Tier</th>
                        <th className="px-3 py-2.5">TwoSIDES Adverse Reaction</th>
                        <th className="px-3 py-2.5">Pharmacological Mechanism</th>
                        <th className="px-3 py-2.5 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      {data.twosides_ddi_edges?.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-slate-500 italic">
                            Zero severe TwoSIDES adverse drug reactions mapped for this agent.
                          </td>
                        </tr>
                      ) : (
                        data.twosides_ddi_edges?.map((edge, idx) => (
                          <tr key={idx} className="hover:bg-slate-900/50 transition-colors">
                            <td className="px-3 py-2.5 font-bold text-white flex items-center space-x-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                              <span>{edge.partner_name}</span>
                              <span className="text-[9px] font-mono text-slate-500">({edge.partner_id})</span>
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                  edge.severity_tier === 'Critical'
                                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                }`}
                              >
                                {edge.severity_tier}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-medium text-amber-400">{edge.twosides_side_effect}</td>
                            <td className="px-3 py-2.5 text-slate-300 text-[11px] leading-relaxed max-w-sm">
                              {edge.mechanism}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <button
                                onClick={() => onCompareInTab1(data.drug_id, edge.partner_id)}
                                className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/60 font-medium text-[10px] transition-colors whitespace-nowrap shadow-sm"
                              >
                                ⚡ Test Clash in Tab 1
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 4: Safe Same-Class Within-Class Alternatives */}
              <div className="p-4 rounded-xl bg-slate-950 border border-emerald-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Safe Same-Class Within-Family Alternatives (D_ij' = 0)
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Within-Class Substitution
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.safe_class_alternatives?.length === 0 ? (
                    <div className="col-span-2 p-4 text-center text-slate-500 text-xs italic bg-slate-900/40 rounded-xl border border-slate-800">
                      No alternate agents documented in ATC-3 class {data.ontology_chain?.atc3_code}.
                    </div>
                  ) : (
                    data.safe_class_alternatives?.map((alt, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-xl bg-slate-900/80 border border-emerald-900/40 hover:border-emerald-700/80 transition-all flex flex-col justify-between space-y-2"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-white flex items-center gap-1.5">
                              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                              {alt.name}
                              <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                                [{alt.atc4_code || alt.drug_id}]
                              </span>
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
                              D_ij' = 0
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-300 leading-relaxed mt-1.5">
                            {alt.clinical_rationale}
                          </p>
                        </div>
                        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
                          <span className="text-slate-400 font-mono">RxCUI: {alt.rxcui || 'N/A'}</span>
                          <button
                            onClick={() => {
                              onPrescribe(alt.drug_id);
                              onClose();
                            }}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors flex items-center space-x-1 shadow-sm"
                          >
                            <Plus className="w-3 h-3" />
                            <span>Prescribe Alternative</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/90 flex items-center justify-between flex-shrink-0 text-xs text-slate-500">
          <span>SafeAudit-CDSS Cheminformatics Engine · Grounded in SafeDrug (IJCAI '21) & TwoSIDES Database</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
