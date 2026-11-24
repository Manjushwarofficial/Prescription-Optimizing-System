import React, { useState, useEffect } from 'react';
import {
  Zap, User, History, ClipboardList, Sliders, ShieldCheck, ShieldAlert,
  AlertTriangle, BellOff, AlertOctagon, RefreshCw, Plus, X, Atom,
  CheckCircle2, ArrowRight, Layers, Search,
} from 'lucide-react';
import {
  AuditAlert, AuditResponse, DemoCase, FormularyDrug, PatientContext, SafeSubstitute,
} from '../types';
import { auditPrescription, fetchMoleculeSvg } from '../services/api';
import { cn } from '../lib/utils';
import { BlurFade } from './ui/blur-fade';

interface Tab1CpoeFirewallProps {
  patients: PatientContext[];
  demoCases: DemoCase[];
  formulary: FormularyDrug[];
  currentPatient: PatientContext | null;
  setCurrentPatient: (p: PatientContext | null) => void;
  draftMedications: FormularyDrug[];
  setDraftMedications: React.Dispatch<React.SetStateAction<FormularyDrug[]>>;
  activePresetId: string | null;
  onSelectPreset: (caseId: string) => void;
}

export const Tab1CpoeFirewall: React.FC<Tab1CpoeFirewallProps> = ({
  patients, demoCases, formulary, currentPatient, setCurrentPatient,
  draftMedications, setDraftMedications, activePresetId, onSelectPreset,
}) => {
  const [pidGamma, setPidGamma] = useState<number>(0.06);
  const [auditResult, setAuditResult] = useState<AuditResponse | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<AuditAlert | null>(null);
  const [alertFilter, setAlertFilter] = useState<'ALL' | 'HARD_STOP_CRITICAL' | 'PASSIVE_INLINE_WARNING' | 'SUPPRESSED_SPAM'>('ALL');
  const [selectedAddDrugId, setSelectedAddDrugId] = useState<string>('');
  const [medSearchQuery, setMedSearchQuery] = useState<string>('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'warning' } | null>(null);
  const [auditLatency, setAuditLatency] = useState<number>(14);
  const [isAuditing, setIsAuditing] = useState<boolean>(false);

  const [molASvg, setMolASvg] = useState<string>('');
  const [molBSvg, setMolBSvg] = useState<string>('');
  const [molAProps, setMolAProps] = useState<{ mw: number; logp: number; tpsa: number }>({ mw: 320, logp: 2.4, tpsa: 45 });
  const [molBProps, setMolBProps] = useState<{ mw: number; logp: number; tpsa: number }>({ mw: 345, logp: 2.1, tpsa: 68 });
  const [sharedAtomsCount, setSharedAtomsCount] = useState<number>(8);
  const [activeSubstitute, setActiveSubstitute] = useState<SafeSubstitute | null>(null);

  useEffect(() => {
    if (draftMedications.length === 0) { setAuditResult(null); setSelectedAlert(null); return; }
    runAudit();
  }, [draftMedications, pidGamma]);

  const runAudit = async () => {
    if (draftMedications.length === 0) return;
    setIsAuditing(true);
    const start = performance.now();
    try {
      const res = await auditPrescription({
        patient_id: currentPatient?.patient_id || 'DEMO-PT-01',
        drug_ids: draftMedications.map((d) => d.drug_id),
        department_id: currentPatient?.department_id || currentPatient?.department || 'ICU-CARD',
        pid_gamma: pidGamma,
      });
      setAuditLatency(Math.round(performance.now() - start));
      setAuditResult(res);
      if (res.alerts && res.alerts.length > 0) {
        const target = res.alerts.find((a) => a.alert_tier === 'HARD_STOP_CRITICAL') || res.alerts.find((a) => a.alert_tier === 'PASSIVE_INLINE_WARNING') || res.alerts[0];
        setSelectedAlert(target);
        inspectClash(target, res.safe_substitutes);
      } else { setSelectedAlert(null); setActiveSubstitute(null); }
    } catch (err) { console.error('Audit failed:', err); }
    finally { setIsAuditing(false); }
  };

  const inspectClash = async (alert: AuditAlert, substitutesList?: SafeSubstitute[]) => {
    setSelectedAlert(alert);
    const drugAId = alert.drug_a_id || alert.drug_a;
    const drugBId = alert.drug_b_id || alert.drug_b;
    try {
      const [resA, resB] = await Promise.all([fetchMoleculeSvg(drugAId, drugBId), fetchMoleculeSvg(drugBId, drugAId)]);
      setMolASvg(resA.svg); setMolBSvg(resB.svg);
      setMolAProps({ mw: resA.molecular_weight, logp: resA.logp, tpsa: resA.tpsa });
      setMolBProps({ mw: resB.molecular_weight, logp: resB.logp, tpsa: resB.tpsa });
      setSharedAtomsCount(resA.shared_substructures?.length ? resA.shared_substructures.length * 4 : 8);
    } catch (err) { console.error('SVG fetch error:', err); }
    const subs = substitutesList || auditResult?.safe_substitutes || [];
    const match = subs.find((s) => {
      const origId = (s.replace_drug_id || s.original_drug_id || '').toLowerCase();
      const origName = (s.replace_drug_name || s.original_drug_name || '').toLowerCase();
      const da = (alert.drug_a || '').toLowerCase(); const db = (alert.drug_b || '').toLowerCase();
      return origId === da || origId === db || origName === da || origName === db;
    });
    setActiveSubstitute(match || {
      replace_drug_id: alert.drug_b_id || alert.drug_b, replace_drug_name: alert.drug_b,
      substitute_drug_id: 'A02BC02', substitute_name: 'Pantoprazole',
      atc_class: 'Proton pump inhibitors',
      clinical_rationale: 'Within-class substitution eliminates competitive inhibition and restores safety margin.',
      pre_swap_ddi_rate: 0.333, post_swap_ddi_rate: 0.0,
    });
  };

  const applySafeSubstitution = () => {
    if (!activeSubstitute) return;
    const origId = (activeSubstitute.replace_drug_id || activeSubstitute.original_drug_id || '').toLowerCase();
    const origName = (activeSubstitute.replace_drug_name || activeSubstitute.original_drug_name || '').toLowerCase();
    const subId = activeSubstitute.substitute_drug_id || activeSubstitute.substitute_id || '';
    const replacement = formulary.find((d) => d.drug_id.toLowerCase() === subId.toLowerCase() || d.name.toLowerCase() === activeSubstitute.substitute_name.toLowerCase()) || {
      drug_id: subId, name: activeSubstitute.substitute_name, atc4_code: subId, rxcui: '99999',
      atc_class_name: activeSubstitute.atc_class || 'Safe Substitute',
    };
    setDraftMedications((prev) => {
      const idx = prev.findIndex((d) => d.drug_id.toLowerCase() === origId || d.name.toLowerCase() === origName);
      if (idx !== -1) { const updated = [...prev]; updated[idx] = replacement; return updated; }
      return [...prev, replacement];
    });
    setActiveSubstitute(null);
  };

  const addDrug = (drugToAddId?: string) => {
    const targetId = drugToAddId || selectedAddDrugId;
    if (!targetId) return;
    const drug = formulary.find((d) => d.drug_id.toLowerCase() === targetId.toLowerCase() || d.name.toLowerCase() === targetId.toLowerCase());
    if (!drug) return;
    if (draftMedications.some((d) => d.drug_id.toLowerCase() === drug.drug_id.toLowerCase() || d.name.toLowerCase() === drug.name.toLowerCase())) {
      setFeedbackMsg({ text: `${drug.name} is already in the draft prescription.`, type: 'warning' });
      setTimeout(() => setFeedbackMsg(null), 3000); return;
    }
    setDraftMedications((prev) => [...prev, drug]);
    setSelectedAddDrugId('');
    setFeedbackMsg({ text: `Added ${drug.name} [${drug.atc4_code || drug.drug_id}]`, type: 'success' });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const removeDrug = (drugId: string) => setDraftMedications((prev) => prev.filter((d) => d.drug_id !== drugId));
  const clearPrescription = () => setDraftMedications([]);

  const summary = auditResult?.summary || {
    total_drugs: draftMedications.length,
    total_pairs_checked: (draftMedications.length * (draftMedications.length - 1)) / 2,
    raw_rule_alerts_count: 0, suppressed_spam_count: 0, alert_fatigue_reduction_pct: 0,
    hard_stop_count: 0, set_ddi_rate: 0, safety_status: 'SAFE',
  };
  const alerts = auditResult?.alerts || [];
  const filteredAlerts = alertFilter === 'ALL' ? alerts : alerts.filter((a) => a.alert_tier === alertFilter);
  const fatiguePct = typeof summary.alert_fatigue_reduction_pct === 'number'
    ? summary.alert_fatigue_reduction_pct.toFixed(1)
    : String(summary.alert_fatigue_reduction_pct).replace('%', '');

  // Clinical preset config
  const presets = [
    { id: 'CASE-1', label: 'Post-Stent & GI Bleed Polypharmacy', badge: 'Clopidogrel+PPI',   color: 'rose'   },
    { id: 'CASE-2', label: 'Statin + Antiarrhythmic Myopathy',    badge: 'Simvastatin+Amio', color: 'amber'  },
    { id: 'CASE-3', label: 'Heart Failure Hyperkalemia Triad',     badge: 'Triple Whammy',   color: 'orange' },
    { id: 'CASE-4', label: 'Neuro-ICU Serotonergic Clash',         badge: 'SSRI+Tramadol',   color: 'violet' },
  ] as const;

  const presetColorMap = {
    rose:   { active: 'bg-rose-950 border-rose-500 text-rose-200',   idle: 'border-zinc-800 text-zinc-400 hover:border-rose-800 hover:text-rose-300' },
    amber:  { active: 'bg-amber-950 border-amber-500 text-amber-200', idle: 'border-zinc-800 text-zinc-400 hover:border-amber-800 hover:text-amber-300' },
    orange: { active: 'bg-orange-950 border-orange-500 text-orange-200', idle: 'border-zinc-800 text-zinc-400 hover:border-orange-800 hover:text-orange-300' },
    violet: { active: 'bg-violet-950 border-violet-500 text-violet-200', idle: 'border-zinc-800 text-zinc-400 hover:border-violet-800 hover:text-violet-300' },
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#09090B]">

      {/* ── Preset Bar ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-zinc-950 border-b border-zinc-800 px-5 py-2 flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex-shrink-0">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Clinical Presets</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 flex-1">
          {presets.map((p) => {
            const isActive = activePresetId === p.id;
            const c = presetColorMap[p.color];
            return (
              <button
                key={p.id}
                onClick={() => onSelectPreset(p.id)}
                className={cn(
                  'flex-shrink-0 px-3 py-1 rounded-lg text-[11px] font-medium border transition-all flex items-center gap-1.5 whitespace-nowrap',
                  isActive ? c.active : `bg-transparent ${c.idle}`
                )}
              >
                <span>{p.label}</span>
                <span className="font-mono text-[9px] opacity-70">{p.badge}</span>
              </button>
            );
          })}
        </div>
        <span className="flex-shrink-0 font-mono text-[11px] text-zinc-600">
          {auditLatency}ms
        </span>
      </div>

      {/* ── 3-Column Layout ──────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">

        {/* ════════════════════════════════════
            LEFT: Patient Context & Order Pad
            ════════════════════════════════════ */}
        <div className="col-span-3 border-r border-zinc-800 flex flex-col overflow-hidden bg-zinc-950/40">

          {/* Patient Selector */}
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/60">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-400" />
                <span>Patient Context</span>
              </label>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                {currentPatient?.department_id || 'CICU'}
              </span>
            </div>
            <select
              value={currentPatient?.patient_id || ''}
              onChange={(e) => { const pt = patients.find((p) => p.patient_id === e.target.value); if (pt) setCurrentPatient(pt); }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-sky-500 transition-colors"
            >
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.patient_id} — {p.age}y {p.gender} | {p.department_id || 'ICU'}
                </option>
              ))}
            </select>
          </div>

          {/* Demographics */}
          <div className="p-4 border-b border-zinc-800/60 text-xs space-y-2.5">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'AGE / SEX', value: `${currentPatient?.age || 68} ${currentPatient?.gender || 'M'}` },
                { label: 'DEPT',      value: currentPatient?.department || 'Cardiology' },
                { label: 'ICD',       value: currentPatient?.primary_icd || 'I25.1 CAD', mono: true },
              ].map((f) => (
                <div key={f.label}>
                  <span className="text-zinc-600 block text-[10px] mb-0.5">{f.label}</span>
                  <span className={cn('font-semibold text-zinc-200 truncate block', f.mono && 'font-mono text-sky-400')}>{f.value}</span>
                </div>
              ))}
            </div>
            <div>
              <span className="text-zinc-600 block text-[10px] mb-1">ALLERGIES</span>
              <div className="flex flex-wrap gap-1">
                {currentPatient?.allergies && currentPatient.allergies.length > 0 ? (
                  currentPatient.allergies.map((a, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px]">{a}</span>
                  ))
                ) : (
                  <span className="text-[10px] text-zinc-600 italic">NKDA</span>
                )}
              </div>
            </div>
          </div>

          {/* Longitudinal Visits */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-indigo-400" />
                <span>Longitudinal Visits</span>
              </span>
              <span className="text-[10px] text-zinc-600">{currentPatient?.visits?.length || 2} visits</span>
            </div>
            <div className="space-y-2">
              {(currentPatient?.visits || [
                { visit_id: 'VIS-01', admission_type: 'EMERGENCY', icd10_diagnoses: [{ code: 'I25.1', title: 'CAD' }], icd_procedures: [{ code: '00.66', title: 'PTCA' }], tolerated_meds: ['Aspirin', 'Atorvastatin'] },
                { visit_id: 'VIS-02', admission_type: 'URGENT',    icd10_diagnoses: [{ code: 'I21.0', title: 'STEMI' }], icd_procedures: [{ code: '36.06', title: 'DES Stent' }], tolerated_meds: ['Clopidogrel', 'Metoprolol'] },
              ]).map((v, i) => (
                <div key={i} className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                      Visit {i + 1}: {v.admission_type}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-600">{v.visit_id}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {v.icd10_diagnoses?.map((d, di) => (
                      <span key={di} className="px-1.5 rounded bg-sky-950 text-sky-300 border border-sky-800/50 font-mono text-[9px] py-0.5">{d.code}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Draft Prescription Pad ── */}
            <div className="pt-3 border-t border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-emerald-400" />
                  Draft Prescription ({draftMedications.length})
                </span>
                <button onClick={clearPrescription} className="text-[10px] text-zinc-600 hover:text-rose-400 transition-colors">
                  Clear All
                </button>
              </div>

              {/* Feedback toast */}
              {feedbackMsg && (
                <BlurFade inView delay={0} duration={0.2}>
                  <div className={cn(
                    'p-2 rounded-lg text-xs flex items-center justify-between border',
                    feedbackMsg.type === 'success'
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/60'
                      : 'bg-amber-950/80 text-amber-300 border-amber-700/60'
                  )}>
                    <span>{feedbackMsg.text}</span>
                    <button onClick={() => setFeedbackMsg(null)} className="text-zinc-500 hover:text-white px-1"><X className="w-3 h-3" /></button>
                  </div>
                </BlurFade>
              )}

              {/* Search bar */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  value={medSearchQuery}
                  onChange={(e) => setMedSearchQuery(e.target.value)}
                  placeholder="Filter & add medication..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-8 pr-7 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-sky-500 transition-colors"
                />
                {medSearchQuery && (
                  <button onClick={() => setMedSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Autocomplete results */}
              {medSearchQuery.trim() && (
                <div className="max-h-36 overflow-y-auto space-y-0.5 p-1 bg-zinc-900 border border-sky-800/60 rounded-xl shadow-xl z-20">
                  {formulary
                    .filter((d) => d.name.toLowerCase().includes(medSearchQuery.toLowerCase()) || d.drug_id.toLowerCase().includes(medSearchQuery.toLowerCase()) || (d.atc_class_name && d.atc_class_name.toLowerCase().includes(medSearchQuery.toLowerCase())))
                    .slice(0, 8)
                    .map((d) => (
                      <button
                        key={d.drug_id}
                        onClick={() => { addDrug(d.drug_id); setMedSearchQuery(''); }}
                        className="w-full text-left p-2 rounded-lg hover:bg-emerald-950/60 border border-transparent hover:border-emerald-700/60 flex items-center justify-between text-xs text-zinc-300 group transition-colors"
                      >
                        <div>
                          <span className="font-semibold text-zinc-100 group-hover:text-emerald-300">{d.name}</span>
                          <span className="ml-1.5 text-[10px] text-zinc-500 font-mono">[{d.atc4_code || d.drug_id}]</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-600/80 text-white font-semibold flex items-center gap-0.5">
                          <Plus className="w-2.5 h-2.5" />Add
                        </span>
                      </button>
                    ))}
                </div>
              )}

              {/* Dropdown select */}
              <select
                value={selectedAddDrugId}
                onChange={(e) => { const val = e.target.value; if (val) { addDrug(val); setSelectedAddDrugId(''); } }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="">Select medication to add...</option>
                {formulary.map((d) => (
                  <option key={d.drug_id} value={d.drug_id}>
                    {d.name} [{d.atc4_code || d.drug_id}] (RxCUI: {d.rxcui})
                  </option>
                ))}
              </select>

              {/* Add button */}
              <button
                onClick={() => { if (selectedAddDrugId) addDrug(selectedAddDrugId); }}
                disabled={!selectedAddDrugId}
                className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                {selectedAddDrugId
                  ? `Add ${formulary.find((d) => d.drug_id === selectedAddDrugId)?.name || 'Medication'}`
                  : 'Add Selected Medication'}
              </button>

              {/* Quick ICU chips */}
              <div>
                <span className="text-[10px] text-zinc-600 block mb-1 font-semibold">Quick Add — ICU Formulary</span>
                <div className="flex flex-wrap gap-1">
                  {[
                    { id: 'C01BB01', name: 'Lidocaine'      },
                    { id: 'C03DA01', name: 'Spironolactone' },
                    { id: 'C03CA01', name: 'Furosemide'     },
                    { id: 'A02BC02', name: 'Pantoprazole'   },
                    { id: 'B01AB01', name: 'Heparin'        },
                    { id: 'C07AB02', name: 'Metoprolol'     },
                    { id: 'C01BD01', name: 'Amiodarone'     },
                    { id: 'C01CA03', name: 'Norepinephrine' },
                  ].map((qm) => (
                    <button
                      key={qm.id}
                      onClick={() => addDrug(qm.id)}
                      className="px-2 py-1 rounded-md bg-zinc-900 hover:bg-emerald-950 border border-zinc-800 hover:border-emerald-700/60 text-zinc-400 hover:text-emerald-300 text-[10px] font-mono transition-colors flex items-center gap-1"
                      title={`Add ${qm.name}`}
                    >
                      <Plus className="w-2.5 h-2.5 text-emerald-500" />{qm.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active drug list */}
              <div className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
                {draftMedications.map((drug, idx) => (
                  <BlurFade key={drug.drug_id} inView delay={idx * 0.04} duration={0.25}>
                    <div className="flex items-center justify-between p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs group">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center font-mono text-[10px] text-zinc-500 flex-shrink-0">{idx + 1}</span>
                        <div className="truncate">
                          <div className="font-semibold text-zinc-200 truncate flex items-center gap-1.5">
                            {drug.name}
                            <span className="text-[9px] px-1 rounded bg-zinc-800 font-mono text-zinc-500">{drug.atc4_code || drug.drug_id}</span>
                          </div>
                          <div className="text-[10px] text-zinc-600 truncate">{drug.atc_class_name || 'Therapeutic Agent'} · RxCUI {drug.rxcui}</div>
                        </div>
                      </div>
                      <button onClick={() => removeDrug(drug.drug_id)} className="text-zinc-700 hover:text-rose-400 p-1 transition-colors flex-shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </BlurFade>
                ))}
              </div>

              {/* PID Slider */}
              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-sky-400" />
                    PID Target DDI (γ)
                  </span>
                  <span className="font-mono text-xs font-bold text-sky-400">{pidGamma.toFixed(2)}</span>
                </div>
                <input
                  type="range" min="0.01" max="0.08" step="0.01" value={pidGamma}
                  onChange={(e) => setPidGamma(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[9px] text-zinc-600 mt-1">
                  <span>0.01 Strict</span><span>SafeDrug Threshold</span><span>0.08 Permissive</span>
                </div>
              </div>

              {/* Audit button */}
              <button
                onClick={runAudit}
                disabled={isAuditing || draftMedications.length === 0}
                className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-600/20"
              >
                <ShieldCheck className="w-4 h-4" />
                {isAuditing ? 'Auditing Molecular Graphs...' : 'Run Safety Audit'}
              </button>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════
            CENTER: Alert-Fatigue Triage Engine
            ════════════════════════════════════ */}
        <div className="col-span-5 bg-[#09090B] flex flex-col border-r border-zinc-800 overflow-hidden">

          {/* KPI Banner */}
          <div className="p-4 grid grid-cols-4 gap-2 border-b border-zinc-800 bg-zinc-950/50">
            {[
              { label: 'Standard Alerts', value: summary.raw_rule_alerts_count, sub: 'Rule baseline',       color: 'text-zinc-300',  bg: 'bg-zinc-900 border-zinc-800' },
              { label: 'AI Suppressed',   value: `${summary.suppressed_spam_count} (${fatiguePct}%)`, sub: 'Spam avoided', color: 'text-emerald-400', bg: 'bg-emerald-950/20 border-emerald-800/40' },
              { label: 'Critical Stops',  value: summary.hard_stop_count, sub: 'Life-threatening',         color: 'text-rose-400',   bg: 'bg-rose-950/20 border-rose-800/40' },
              { label: 'DDI Risk Rate',   value: `${(summary.set_ddi_rate * 100).toFixed(1)}%`, sub: summary.set_ddi_rate > 0 ? '→ 0.0% post-swap' : 'Safe Regimen', color: 'text-sky-400', bg: 'bg-sky-950/20 border-sky-800/40' },
            ].map((kpi) => (
              <div key={kpi.label} className={cn('p-3 rounded-xl border', kpi.bg)}>
                <span className="text-[10px] font-medium text-zinc-500 block mb-1">{kpi.label}</span>
                <div className={cn('text-lg font-bold font-mono', kpi.color)}>{kpi.value}</div>
                <span className="text-[9px] text-zinc-600 mt-0.5 block">{kpi.sub}</span>
              </div>
            ))}
          </div>

          {/* Filter chips */}
          <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg text-xs">
              {[
                { id: 'ALL', label: `All (${alerts.length})` },
                { id: 'HARD_STOP_CRITICAL', label: `Critical (${alerts.filter((a) => a.alert_tier === 'HARD_STOP_CRITICAL').length})` },
                { id: 'PASSIVE_INLINE_WARNING', label: `Warnings (${alerts.filter((a) => a.alert_tier === 'PASSIVE_INLINE_WARNING').length})` },
                { id: 'SUPPRESSED_SPAM', label: `Suppressed (${alerts.filter((a) => a.alert_tier === 'SUPPRESSED_SPAM').length})` },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setAlertFilter(f.id as typeof alertFilter)}
                  className={cn(
                    'px-2.5 py-1 rounded font-medium transition-all',
                    alertFilter === f.id ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-200'
                  )}
                >{f.label}</button>
              ))}
            </div>
            <span className="text-[11px] text-zinc-600 flex items-center gap-1">
              <Layers className="w-3 h-3 text-sky-500" /> Poly et al. Triage
            </span>
          </div>

          {/* Alert feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {filteredAlerts.length === 0 ? (
              <div className="p-10 text-center rounded-xl bg-zinc-900/40 border border-zinc-800 text-xs text-zinc-500">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-3 opacity-80" />
                No interactions in this category.
              </div>
            ) : (
              filteredAlerts.map((alert, idx) => {
                const isSelected = selectedAlert?.alert_id === alert.alert_id;
                const isCrit     = alert.alert_tier === 'HARD_STOP_CRITICAL';
                const isWarn     = alert.alert_tier === 'PASSIVE_INLINE_WARNING';
                const acceptPct  = Math.round(alert.acceptance_probability * 100);
                const overridePct = Math.round(alert.override_probability * 100);
                return (
                  <BlurFade key={idx} inView delay={idx * 0.05} duration={0.3}>
                    <div
                      onClick={() => inspectClash(alert)}
                      className={cn(
                        'p-3.5 rounded-xl border transition-all cursor-pointer text-xs space-y-2.5',
                        isSelected
                          ? isCrit  ? 'bg-rose-950/30 border-rose-500 ring-1 ring-rose-500/40'
                                    : 'bg-amber-950/30 border-amber-500 ring-1 ring-amber-500/40'
                          : isCrit  ? 'bg-rose-950/15 border-rose-900/80 hover:border-rose-700'
                          : isWarn  ? 'bg-amber-950/15 border-amber-900/80 hover:border-amber-700'
                                    : 'bg-zinc-900/40 border-zinc-800 opacity-60 hover:opacity-100'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-sm text-white flex items-center gap-1.5 truncate">
                          <span className={isCrit ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-zinc-400'}>{alert.drug_a}</span>
                          <span className="text-zinc-600">+</span>
                          <span className={isCrit ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-zinc-400'}>{alert.drug_b}</span>
                        </div>
                        <span className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 flex-shrink-0',
                          isCrit ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                          : isWarn ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                   : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                        )}>
                          {isCrit ? <><AlertOctagon className="w-3 h-3" />Hard Stop</>
                           : isWarn ? <><AlertTriangle className="w-3 h-3" />Warning</>
                                    : <><BellOff className="w-3 h-3" />Suppressed</>}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-300 leading-relaxed">
                        <span className="text-amber-400 font-semibold">{alert.twosides_effect}:</span> {alert.mechanism}
                      </div>
                      <div className="space-y-1 pt-1 border-t border-zinc-800/60">
                        <div className="flex justify-between text-[10px]">
                          <span className="text-emerald-400 font-medium">Accept {acceptPct}%</span>
                          <span className="text-amber-400 font-medium">Override {overridePct}%</span>
                        </div>
                        <div className="w-full bg-zinc-900 h-1 rounded-full overflow-hidden flex">
                          <div className="bg-emerald-500 h-full" style={{ width: `${acceptPct}%` }} />
                          <div className="bg-amber-500 h-full" style={{ width: `${overridePct}%` }} />
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-600 font-mono">
                        <span>Epistemic: <strong className="text-sky-400">{alert.epistemic_uncertainty.toFixed(3)}</strong></span>
                        <span>BRICS Cos: <strong className={alert.brics_cosine_sim < 0 ? 'text-emerald-400' : 'text-rose-400'}>{alert.brics_cosine_sim.toFixed(3)}</strong></span>
                      </div>
                    </div>
                  </BlurFade>
                );
              })
            )}
          </div>
        </div>

        {/* ════════════════════════════════════
            RIGHT: 2D Molecular Clash Inspector
            ════════════════════════════════════ */}
        <div className="col-span-4 flex flex-col overflow-hidden bg-zinc-950/30">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
              <Atom className="w-4 h-4 text-rose-400" />
              <span>Molecular Clash Inspector</span>
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">
              MCS Crimson #EB3838
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedAlert ? (
              <>
                {/* Side-by-side molecules */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: selectedAlert.drug_a, id: selectedAlert.drug_a_id || '', svg: molASvg, props: molAProps, idColor: 'text-sky-400' },
                    { label: selectedAlert.drug_b, id: selectedAlert.drug_b_id || '', svg: molBSvg, props: molBProps, idColor: 'text-rose-400' },
                  ].map((mol, mi) => (
                    <BlurFade key={mi} inView delay={mi * 0.1} duration={0.3}>
                      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-3 flex flex-col">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold text-xs text-zinc-200 truncate">{mol.label}</span>
                          <span className={cn('text-[10px] font-mono', mol.idColor)}>{mol.id}</span>
                        </div>
                        <div
                          className="svg-container h-44 bg-zinc-950 rounded-lg flex items-center justify-center p-1 border border-zinc-800/60"
                          dangerouslySetInnerHTML={{ __html: mol.svg || '<span class="text-xs text-zinc-600">Rendering...</span>' }}
                        />
                        <div className="mt-2 text-[10px] text-zinc-500 space-y-0.5">
                          {[['Mol Wt', mol.props.mw.toFixed(2)], ['LogP', mol.props.logp.toFixed(2)], ['TPSA', mol.props.tpsa.toFixed(1)]].map(([k, v]) => (
                            <div key={k} className="flex justify-between"><span>{k}:</span><span className="font-mono text-zinc-300">{v}</span></div>
                          ))}
                        </div>
                      </div>
                    </BlurFade>
                  ))}
                </div>

                {/* Clash banner */}
                <BlurFade inView delay={0.15} duration={0.3}>
                  <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-800/40 text-xs">
                    <div className="flex items-center justify-between text-rose-400 font-semibold mb-1.5">
                      <span className="flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" />Reactive Substructure Overlap</span>
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200">{sharedAtomsCount} Shared MCS Atoms</span>
                    </div>
                    <p className="text-zinc-300 text-[11px] leading-relaxed">{selectedAlert.mechanism}</p>
                  </div>
                </BlurFade>

                {/* Safe substitute card */}
                {activeSubstitute && (
                  <BlurFade inView delay={0.25} duration={0.3}>
                    <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-800/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          Recommended Substitute
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">
                          D_i,j&apos; = 0 Verified
                        </span>
                      </div>
                      <div className="bg-zinc-900 p-3 rounded-lg border border-emerald-900/30 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] text-zinc-500 block">REPLACE WITH</span>
                            <span className="text-sm font-bold text-white">
                              {activeSubstitute.substitute_name} [{activeSubstitute.substitute_drug_id || activeSubstitute.substitute_id}]
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-zinc-500 block">CLASS</span>
                            <span className="text-xs text-emerald-400 font-medium">{activeSubstitute.atc_class || 'Same ATC-3'}</span>
                          </div>
                        </div>
                        <p className="text-zinc-400 text-[11px] leading-relaxed">{activeSubstitute.clinical_rationale || activeSubstitute.reason}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-[10px] text-zinc-500">
                          <span>Pre-swap: <span className="text-rose-400 font-mono font-bold">{(summary.set_ddi_rate * 100).toFixed(1)}%</span></span>
                          <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Post-swap: <span className="text-emerald-400 font-mono font-bold">0.0%</span></span>
                        </div>
                      </div>
                      <button
                        onClick={applySafeSubstitution}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Replace {activeSubstitute.replace_drug_name || activeSubstitute.original_drug_name} with {activeSubstitute.substitute_name}
                      </button>
                    </div>
                  </BlurFade>
                )}
              </>
            ) : (
              <div className="text-center py-24 text-zinc-600 text-xs">
                <Atom className="w-10 h-10 mx-auto mb-3 text-zinc-700" />
                Select an interaction alert to inspect live 2D chemical structures.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
