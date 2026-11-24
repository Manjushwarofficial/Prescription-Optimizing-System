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
  { code: '', label: 'All (74)' },
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
    <div className="h-full flex flex-col p-6 overflow-y-auto space-y-5 max-w-7xl mx-auto w-full bg-[#09090B]">

      {/* ── Header ─────────────────────────────────────────────── */}
      <BlurFade inView delay={0} duration={0.4}>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
                <Dna className="w-5 h-5 text-sky-400" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Cheminformatics & BRICS Substructure Explorer
              </h2>
            </div>
            <p className="text-xs text-zinc-500">
              74 ICU formulary drugs decomposed into 159 unique BRICS fragments and TwoSIDES DDI graph edges.
            </p>
          </div>
          <span className="text-xs px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-sky-400 self-start md:self-auto flex-shrink-0">
            {filteredDrugs.length} / {drugs.length} drugs
          </span>
        </div>
      </BlurFade>

      {/* ── Search + Filter ─────────────────────────────────────── */}
      <BlurFade inView delay={0.08} duration={0.4}>
        <div className="flex flex-col md:flex-row gap-3 items-start md:items-center bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
          <div className="relative w-full md:w-80">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
            <input
              type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, RxCUI, NDC, SMILES..."
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500 flex items-center gap-1 flex-shrink-0">
              <Filter className="w-3.5 h-3.5" /> ATC-3:
            </span>
            <select
              value={selectedAtc} onChange={(e) => setSelectedAtc(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500 transition-colors"
            >
              <option value="">All 14 Classes</option>
              <option value="B01A">B01A — Antithrombotics</option>
              <option value="C10A">C10A — Statins</option>
              <option value="C01B">C01B — Antiarrhythmics</option>
              <option value="C09A">C09A — ACE / ARBs</option>
              <option value="C03C">C03C — Diuretics</option>
              <option value="A02B">A02B — PPIs & H2 Blockers</option>
              <option value="J01M">J01M — Antibacterials</option>
              <option value="N02A">N02A — Opioids</option>
              <option value="N06A">N06A — Antidepressants</option>
              <option value="N03A">N03A — Antiepileptics</option>
              <option value="A10B">A10B — Antidiabetics</option>
              <option value="C07A">C07A — Beta Blockers</option>
            </select>
          </div>
        </div>
      </BlurFade>

      {/* ── ATC Chip Filters ────────────────────────────────────── */}
      <BlurFade inView delay={0.12} duration={0.4}>
        <div className="flex flex-wrap items-center gap-1.5">
          {ATC_CHIPS.map((chip) => (
            <button
              key={chip.code}
              onClick={() => setSelectedAtc(chip.code)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all border',
                selectedAtc === chip.code
                  ? 'bg-sky-500 text-white border-sky-400 shadow-sm shadow-sky-500/30'
                  : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200'
              )}
            >{chip.label}</button>
          ))}
        </div>
      </BlurFade>

      {/* ── Drug Grid ───────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-500 space-y-3">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-mono">Loading 74 ICU formulary drugs...</span>
        </div>
      ) : filteredDrugs.length === 0 ? (
        <div className="text-center py-16 text-zinc-600 text-xs">
          <Atom className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
          No medications match your criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDrugs.map((d, idx) => {
            const bricsCount = (d.brics_fragments || []).length;
            const atcBadge   = d.atc3_code || 'ATC';
            return (
              <BlurFade key={d.drug_id} inView delay={Math.min(idx * 0.04, 0.3)} duration={0.35}>
                <div
                  onClick={() => setInspectingDrugId(d.drug_id)}
                  className="group bg-zinc-900 rounded-2xl border border-zinc-800 hover:border-sky-600/60 p-4 flex flex-col justify-between transition-all duration-200 cursor-pointer relative overflow-hidden"
                >
                  {/* Hover accent line */}
                  <div className="absolute inset-x-0 top-0 h-px bg-sky-500/0 group-hover:bg-sky-500/40 transition-all duration-300" />

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-bold text-sm text-zinc-100 group-hover:text-sky-300 transition-colors tracking-tight">
                          {d.name}
                        </h4>
                        <span className="text-[10px] font-mono text-zinc-500">
                          RxCUI: {d.rxcui} · NDC: {d.ndc_code || 'N/A'}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono flex-shrink-0">
                        {atcBadge}
                      </span>
                    </div>

                    {/* 2D Molecular canvas */}
                    <div className="svg-container h-36 bg-zinc-950 rounded-xl p-2 border border-zinc-800 flex items-center justify-center mb-3">
                      {svgCache[d.drug_id] ? (
                        <div className="w-full h-full flex items-center justify-center" dangerouslySetInnerHTML={{ __html: svgCache[d.drug_id] }} />
                      ) : (
                        <span className="text-[11px] text-zinc-600 animate-pulse">Rendering 2D graph...</span>
                      )}
                    </div>

                    {/* Descriptors */}
                    <div className="grid grid-cols-4 gap-1.5 p-2 rounded-lg bg-zinc-950 border border-zinc-800/60 text-center text-[10px] mb-3">
                      {[
                        { label: 'Mol Wt', val: (d.molecular_weight || 320).toFixed(1) },
                        { label: 'LogP',   val: (d.logp || 2.1).toFixed(1) },
                        { label: 'TPSA',   val: (d.tpsa || 45).toFixed(0) },
                        { label: 'HBD/A',  val: `${d.hbd || 1}/${d.hba || 4}` },
                      ].map((f) => (
                        <div key={f.label}>
                          <span className="text-zinc-600 block text-[9px]">{f.label}</span>
                          <span className="font-mono text-zinc-200 font-semibold">{f.val}</span>
                        </div>
                      ))}
                    </div>

                    {/* BRICS & TwoSIDES badges */}
                    <div className="flex items-center justify-between text-[10px] pt-1.5 border-t border-zinc-800/50 mb-3">
                      <span className="flex items-center gap-1 font-mono text-violet-400">
                        <Boxes className="w-3 h-3 text-violet-500" />
                        |S| = {bricsCount} fragments
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-mono">
                        TwoSIDES
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-800" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setInspectingDrugId(d.drug_id)}
                      className="py-1.5 rounded-lg bg-sky-950/60 hover:bg-sky-900/80 text-sky-300 border border-sky-800/50 text-[11px] font-semibold transition-all flex items-center justify-center gap-1"
                    >
                      <Network className="w-3.5 h-3.5" />Inspect Graph
                    </button>
                    <button
                      onClick={() => onPrescribe(d.drug_id)}
                      className="py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-all flex items-center justify-center gap-1 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" />Add to CPOE
                    </button>
                  </div>
                </div>
              </BlurFade>
            );
          })}
        </div>
      )}

      {/* Modal */}
      <DrugDetailModal drugId={inspectingDrugId} onClose={() => setInspectingDrugId(null)} onPrescribe={onPrescribe} onCompareInTab1={onCompareInTab1} />
    </div>
  );
};
