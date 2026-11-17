import React, { useState, useEffect } from 'react';
import { Search, Plus, Network, Boxes, Dna, Filter } from 'lucide-react';
import { FormularyDrug } from '../types';
import { fetchFormulary, fetchMoleculeSvg } from '../services/api';
import { DrugDetailModal } from './DrugDetailModal';

interface Tab2CheminformaticsProps {
  onPrescribe: (drugId: string) => void;
  onCompareInTab1: (drugAId: string, drugBId: string) => void;
}

const ATC_CHIPS = [
  { code: '', label: 'All Formulary (74)' },
  { code: 'B01A', label: 'B01A Antithrombotics' },
  { code: 'C10A', label: 'C10A Statins / Lipid' },
  { code: 'C01B', label: 'C01B Antiarrhythmics' },
  { code: 'C09A', label: 'C09A ACE / ARBs' },
  { code: 'C03C', label: 'C03C Diuretics' },
  { code: 'A02B', label: 'A02B PPIs / H2' },
  { code: 'J01M', label: 'J01M Antibacterials' },
  { code: 'N02A', label: 'N02A Opioids' },
  { code: 'N06A', label: 'N06A Antidepressants' },
  { code: 'N03A', label: 'N03A Antiepileptics' },
  { code: 'C07A', label: 'C07A Beta Blockers' },
];

export const Tab2Cheminformatics: React.FC<Tab2CheminformaticsProps> = ({
  onPrescribe,
  onCompareInTab1,
}) => {
  const [drugs, setDrugs] = useState<FormularyDrug[]>([]);
  const [selectedAtc, setSelectedAtc] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [inspectingDrugId, setInspectingDrugId] = useState<string | null>(null);
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchFormulary()
      .then((data) => {
        setDrugs(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching formulary:', err);
        setLoading(false);
      });
  }, []);

  // Fetch SVGs for visible drugs
  useEffect(() => {
    if (drugs.length === 0) return;
    drugs.slice(0, 30).forEach((d) => {
      if (!svgCache[d.drug_id]) {
        fetchMoleculeSvg(d.drug_id)
          .then((res) => {
            setSvgCache((prev) => ({ ...prev, [d.drug_id]: res.svg }));
          })
          .catch(() => {});
      }
    });
  }, [drugs]);

  const filteredDrugs = drugs.filter((d) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      d.name.toLowerCase().includes(q) ||
      d.drug_id.toLowerCase().includes(q) ||
      String(d.rxcui).includes(q) ||
      String(d.ndc_code).toLowerCase().includes(q) ||
      (d.smiles && d.smiles.toLowerCase().includes(q));

    const matchesAtc = !selectedAtc || (d.atc3_code || '').startsWith(selectedAtc);
    return matchesSearch && matchesAtc;
  });

  return (
    <div className="h-full flex flex-col p-6 overflow-y-auto space-y-6 max-w-7xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Dna className="w-6 h-6 text-sky-400" />
            Cheminformatics & BRICS Substructure Graph Explorer
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Explore 74 ICU formulary medications decomposed into 159 unique BRICS fragments and TwoSIDES DDI graph edges.
          </p>
        </div>
        <span className="text-xs px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 font-mono text-sky-400 self-start md:self-auto">
          Formulary: {filteredDrugs.length} of {drugs.length} medications
        </span>
      </div>

      {/* Search & ATC Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-800 shadow-md">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search 74 drugs by name, RxCUI, NDC or SMILES..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2 text-xs w-full md:w-auto">
          <span className="text-slate-400 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            ATC-3 Class:
          </span>
          <select
            value={selectedAtc}
            onChange={(e) => setSelectedAtc(e.target.value)}
            className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white flex-1 md:flex-none"
          >
            <option value="">All 14 Therapeutic Classes</option>
            <option value="B01A">B01A - Antithrombotics</option>
            <option value="C10A">C10A - Statins & Lipid Modifiers</option>
            <option value="C01B">C01B - Antiarrhythmics</option>
            <option value="C09A">C09A - ACE Inhibitors / ARBs</option>
            <option value="C03C">C03C - Diuretics</option>
            <option value="A02B">A02B - PPIs & H2 Blockers</option>
            <option value="J01M">J01M - Antibacterials</option>
            <option value="N02A">N02A - Opioids / Analgesics</option>
            <option value="N06A">N06A - Antidepressants</option>
            <option value="N03A">N03A - Antiepileptics</option>
            <option value="A10B">A10B - Antidiabetics</option>
            <option value="C07A">C07A - Beta Blockers</option>
          </select>
        </div>
      </div>

      {/* Quick Filter Chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        {ATC_CHIPS.map((chip) => (
          <button
            key={chip.code}
            onClick={() => setSelectedAtc(chip.code)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
              selectedAtc === chip.code
                ? 'bg-sky-600 text-white shadow-sm'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Grid of Medications */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs font-mono">Loading 74 ICU formulary drugs...</span>
        </div>
      ) : filteredDrugs.length === 0 ? (
        <div className="text-center py-16 text-slate-500 text-xs">
          No medications found matching your criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDrugs.map((d) => {
            const bricsCount = (d.brics_fragments || []).length;
            const atcBadge = d.atc3_code || 'ATC';

            return (
              <div
                key={d.drug_id}
                onClick={() => setInspectingDrugId(d.drug_id)}
                className="group bg-slate-900/80 rounded-2xl border border-slate-800 hover:border-sky-500/80 p-4 flex flex-col justify-between transition-all duration-200 shadow-md hover:shadow-sky-950/30 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="font-bold text-sm text-white group-hover:text-sky-300 transition-colors">
                        {d.name}
                      </h4>
                      <span className="text-[10px] font-mono text-slate-400">
                        RxCUI: {d.rxcui} · NDC: {d.ndc_code || 'N/A'}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                      {atcBadge}
                    </span>
                  </div>

                  {/* 2D Molecular Vector Canvas */}
                  <div className="svg-container h-36 bg-slate-950 rounded-xl p-2 border border-slate-800 flex items-center justify-center mb-3">
                    {svgCache[d.drug_id] ? (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        dangerouslySetInnerHTML={{ __html: svgCache[d.drug_id] }}
                      />
                    ) : (
                      <span className="text-[11px] text-slate-500 animate-pulse">Rendering 2D graph...</span>
                    )}
                  </div>

                  {/* Descriptors */}
                  <div className="grid grid-cols-4 gap-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-center text-[10px] mb-3">
                    <div>
                      <span className="text-slate-500 block text-[9px]">Mol Wt</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {(d.molecular_weight || 320).toFixed(1)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">LogP</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {(d.logp || 2.1).toFixed(1)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">TPSA</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {(d.tpsa || 45).toFixed(0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[9px]">HBD/A</span>
                      <span className="font-mono text-slate-200 font-semibold">
                        {d.hbd || 1}/{d.hba || 4}
                      </span>
                    </div>
                  </div>

                  {/* BRICS & TwoSIDES badges */}
                  <div className="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/60 mb-3 text-slate-400">
                    <span className="flex items-center gap-1 font-mono text-purple-300">
                      <Boxes className="w-3 h-3 text-purple-400" />
                      |S| = {bricsCount} Fragments
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[9px] font-mono">
                      TwoSIDES Active
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div
                  className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => setInspectingDrugId(d.drug_id)}
                    className="w-full py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-800/60 text-[11px] font-semibold transition-all flex items-center justify-center space-x-1"
                  >
                    <Network className="w-3.5 h-3.5" />
                    <span>Inspect Graph</span>
                  </button>
                  <button
                    onClick={() => onPrescribe(d.drug_id)}
                    className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-all flex items-center justify-center space-x-1 shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add to CPOE</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Cheminformatics & TwoSIDES Graph Modal */}
      <DrugDetailModal
        drugId={inspectingDrugId}
        onClose={() => setInspectingDrugId(null)}
        onPrescribe={onPrescribe}
        onCompareInTab1={onCompareInTab1}
      />
    </div>
  );
};
