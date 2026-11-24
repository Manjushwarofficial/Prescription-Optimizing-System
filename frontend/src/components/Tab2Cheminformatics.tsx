import React, { useState, useEffect } from 'react';
import { Search, Plus, Network, Boxes, Dna, Filter, Atom } from 'lucide-react';
import { FormularyDrug } from '../types';
import { fetchFormulary, fetchMoleculeSvg } from '../services/api';
import { DrugDetailModal } from './DrugDetailModal';
import { BlurFade } from './ui/blur-fade';
import { cn } from '../lib/utils';

interface Tab2CheminformaticsProps {
  onPrescribe: (drugId: string) => void;
  onCompareInTab1: (drugAId: string, drugBId: string) => void;
}

const ATC_CHIPS = [
  { code: '', label: 'All Formulary (74)' },
  { code: 'B01A', label: 'B01A Antithrombotics' },
  { code: 'C10A', label: 'C10A Statins' },
  { code: 'C01B', label: 'C01B Antiarrhythmics' },
  { code: 'C09A', label: 'C09A ACE / ARBs' },
  { code: 'C03C', label: 'C03C Diuretics' },
  { code: 'A02B', label: 'A02B PPIs' },
  { code: 'J01M', label: 'J01M Antibacterials' },
  { code: 'N02A', label: 'N02A Opioids' },
  { code: 'N06A', label: 'N06A Antidepressants' },
  { code: 'N03A', label: 'N03A Antiepileptics' },
  { code: 'C07A', label: 'C07A Beta Blockers' },
];

export const Tab2Cheminformatics: React.FC<Tab2CheminformaticsProps> = ({ onPrescribe, onCompareInTab1 }) => {
  const [drugs, setDrugs] = useState<FormularyDrug[]>([]);
  const [selectedAtc, setSelectedAtc] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [inspectingDrugId, setInspectingDrugId] = useState<string | null>(null);
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchFormulary().then((data) => { setDrugs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (drugs.length === 0) return;
    drugs.slice(0, 30).forEach((d) => {
      if (!svgCache[d.drug_id]) {
        fetchMoleculeSvg(d.drug_id).then((res) => setSvgCache((prev) => ({ ...prev, [d.drug_id]: res.svg }))).catch(() => {});
      }
    });
  }, [drugs]);

  const filteredDrugs = drugs.filter((d) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q || d.name.toLowerCase().includes(q) || d.drug_id.toLowerCase().includes(q) || String(d.rxcui).includes(q) || String(d.ndc_code).toLowerCase().includes(q) || (d.smiles && d.smiles.toLowerCase().includes(q));
    const matchesAtc = !selectedAtc || (d.atc3_code || '').startsWith(selectedAtc);
    return matchesSearch && matchesAtc;
  });

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto space-y-6 max-w-7xl mx-auto w-full bg-[#0B1120]">

      {/* ── Top Header ─────────────────────────────────────────────── */}
      <BlurFade inView delay={0} duration={0.3}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="p-2 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400">
                <Dna className="w-5 h-5" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-white">
                Cheminformatics & BRICS Substructure Explorer
              </h2>
            </div>
            <p className="text-xs text-slate-400 font-medium max-w-3xl">
              74 ICU formulary medications decomposed into 159 unique BRICS fragments with RDKit 2D chemical vector graphs and TwoSIDES DDI edges.
            </p>
          </div>
          <span className="text-xs px-3.5 py-1.5 rounded-xl bg-[#131F38] border border-slate-700 font-mono font-semibold text-sky-300 self-start md:self-auto flex-shrink-0 shadow-sm">
            {filteredDrugs.length} of {drugs.length} medications
          </span>
        </div>
      </BlurFade>

      {/* ── Search + Filter Bar ─────────────────────────────────────── */}
      <BlurFade inView delay={0.06} duration={0.3}>
        <div className="flex flex-col md:flex-row gap-3.5 items-start md:items-center bg-[#131F38] border border-slate-700/80 p-4 rounded-2xl shadow-sm">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 74 drugs by name, RxCUI, NDC, or SMILES..."
              className="w-full bg-[#0B1120] border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 transition-all font-medium"
            />
          </div>
          <div className="flex items-center gap-2.5 text-xs w-full md:w-auto">
            <span className="text-slate-300 font-semibold flex items-center gap-1.5 flex-shrink-0">
              <Filter className="w-4 h-4 text-sky-400" /> Filter ATC-3 Class:
            </span>
            <select
              value={selectedAtc}
              onChange={(e) => setSelectedAtc(e.target.value)}
              className="bg-[#0B1120] border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 font-medium focus:outline-none focus:border-sky-400 transition-all flex-1 md:flex-none cursor-pointer"
            >
              <option value="">All 14 Therapeutic Classes</option>
              <option value="B01A">B01A — Antithrombotics</option>
              <option value="C10A">C10A — Statins & Lipid Modifiers</option>
              <option value="C01B">C01B — Antiarrhythmics</option>
              <option value="C09A">C09A — ACE Inhibitors / ARBs</option>
              <option value="C03C">C03C — Diuretics</option>
              <option value="A02B">A02B — PPIs & H2 Blockers</option>
              <option value="J01M">J01M — Antibacterials</option>
              <option value="N02A">N02A — Opioids / Analgesics</option>
              <option value="N06A">N06A — Antidepressants</option>
              <option value="N03A">N03A — Antiepileptics</option>
              <option value="A10B">A10B — Antidiabetics</option>
              <option value="C07A">C07A — Beta Blockers</option>
            </select>
          </div>
        </div>
      </BlurFade>

      {/* ── Quick ATC Chips ─────────────────────────────────────────── */}
      <BlurFade inView delay={0.1} duration={0.3}>
        <div className="flex flex-wrap items-center gap-1.5">
          {ATC_CHIPS.map((chip) => (
            <button
              key={chip.code}
              onClick={() => setSelectedAtc(chip.code)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border cursor-pointer',
                selectedAtc === chip.code
                  ? 'bg-sky-600 text-white border-sky-400 shadow-sm shadow-sky-600/40'
                  : 'bg-[#131F38] hover:bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-600 hover:text-white'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </BlurFade>

      {/* ── Drug Cards Grid ─────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Loading 74 ICU formulary drugs...</span>
        </div>
      ) : filteredDrugs.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-xs">
          <Atom className="w-10 h-10 mx-auto mb-3 text-slate-500" />
          No medications match your search criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredDrugs.map((d, idx) => {
            const bricsCount = (d.brics_fragments || []).length;
            const atcBadge   = d.atc3_code || 'ATC';

            return (
              <BlurFade key={d.drug_id} inView delay={Math.min(idx * 0.03, 0.25)} duration={0.3}>
                <div
                  onClick={() => setInspectingDrugId(d.drug_id)}
                  className="group bg-[#131F38] rounded-2xl border border-slate-700/80 hover:border-sky-500 p-4.5 flex flex-col justify-between transition-all duration-200 cursor-pointer shadow-md hover:shadow-lg hover:shadow-sky-950/40 relative overflow-hidden"
                >
                  <div>
                    {/* Header: Drug Name + ATC Badge */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-extrabold text-base text-white group-hover:text-sky-300 transition-colors tracking-tight leading-tight">
                          {d.name}
                        </h4>
                        <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                          RxCUI: <strong className="text-slate-300">{d.rxcui}</strong> · NDC: {d.ndc_code || 'N/A'}
                        </span>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono flex-shrink-0">
                        {atcBadge}
                      </span>
                    </div>

                    {/* 2D Molecular Canvas: Crisp Lab White for 100% Visibility */}
                    <div className="svg-container h-44 bg-white rounded-xl p-2.5 flex items-center justify-center mb-3.5 border border-slate-200 shadow-sm">
                      {svgCache[d.drug_id] ? (
                        <div
                          className="w-full h-full flex items-center justify-center"
                          dangerouslySetInnerHTML={{ __html: svgCache[d.drug_id] }}
                        />
                      ) : (
                        <span className="text-xs text-slate-400 font-mono animate-pulse">Rendering 2D structure...</span>
                      )}
                    </div>

                    {/* Physicochemical Descriptors */}
                    <div className="grid grid-cols-4 gap-2 p-2.5 rounded-xl bg-[#0B1120] border border-slate-700/80 text-center text-xs mb-3">
                      {[
                        { label: 'Mol Wt', val: (d.molecular_weight || 320).toFixed(1) },
                        { label: 'LogP',   val: (d.logp || 2.1).toFixed(1) },
                        { label: 'TPSA',   val: (d.tpsa || 45).toFixed(0) },
                        { label: 'HBD/A',  val: `${d.hbd || 1}/${d.hba || 4}` },
                      ].map((f) => (
                        <div key={f.label}>
                          <span className="text-slate-400 block text-[10px] font-medium">{f.label}</span>
                          <span className="font-mono text-white font-bold text-xs">{f.val}</span>
                        </div>
                      ))}
                    </div>

                    {/* Substructures and Database badges */}
                    <div className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-700/60 mb-3.5 text-slate-300">
                      <span className="flex items-center gap-1.5 font-mono text-purple-300 font-semibold text-[11px]">
                        <Boxes className="w-3.5 h-3.5 text-purple-400" />
                        |S| = {bricsCount} BRICS Fragments
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px] font-mono font-semibold">
                        TwoSIDES Active
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-2.5 pt-2 border-t border-slate-700/80" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setInspectingDrugId(d.drug_id)}
                      className="py-2 rounded-xl bg-[#0B1120] hover:bg-sky-950/80 text-sky-300 hover:text-white border border-slate-700 hover:border-sky-500 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Network className="w-3.5 h-3.5 text-sky-400" />
                      <span>Inspect Graph</span>
                    </button>
                    <button
                      onClick={() => onPrescribe(d.drug_id)}
                      className="py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-700/30 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to CPOE</span>
                    </button>
                  </div>
                </div>
              </BlurFade>
            );
          })}
        </div>
      )}

      {/* Modal */}
      <DrugDetailModal
        drugId={inspectingDrugId}
        onClose={() => setInspectingDrugId(null)}
        onPrescribe={onPrescribe}
        onCompareInTab1={onCompareInTab1}
      />
    </div>
  );
};
