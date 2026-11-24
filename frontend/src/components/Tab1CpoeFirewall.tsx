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

  const presets = [
    { id: 'CASE-1', label: 'Post-Stent & GI Bleed Polypharmacy', badge: 'Clopidogrel+PPI',   color: 'rose'   },
    { id: 'CASE-2', label: 'Statin + Antiarrhythmic Myopathy',    badge: 'Simvastatin+Amio', color: 'amber'  },
    { id: 'CASE-3', label: 'Heart Failure Hyperkalemia Triad',     badge: 'Triple Whammy',   color: 'orange' },
    { id: 'CASE-4', label: 'Neuro-ICU Serotonergic Clash',         badge: 'SSRI+Tramadol',   color: 'purple' },
  ] as const;

  const presetColorMap = {
    rose:   { active: 'bg-rose-900/90 border-rose-400 text-white shadow-md shadow-rose-950/60 ring-1 ring-rose-400',   idle: 'bg-[#131F38] border-slate-700 text-slate-200 hover:border-rose-500 hover:text-white' },
    amber:  { active: 'bg-amber-900/90 border-amber-400 text-white shadow-md shadow-amber-950/60 ring-1 ring-amber-400', idle: 'bg-[#131F38] border-slate-700 text-slate-200 hover:border-amber-500 hover:text-white' },
    orange: { active: 'bg-orange-900/90 border-orange-400 text-white shadow-md shadow-orange-950/60 ring-1 ring-orange-400', idle: 'bg-[#131F38] border-slate-700 text-slate-200 hover:border-orange-500 hover:text-white' },
    purple: { active: 'bg-purple-900/90 border-purple-400 text-white shadow-md shadow-purple-950/60 ring-1 ring-purple-400', idle: 'bg-[#131F38] border-slate-700 text-slate-200 hover:border-purple-500 hover:text-white' },
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0B1120]">

      {/* ── Top Clinical Presets Bar ───────────────────────────────── */}
      <div className="flex-shrink-0 bg-[#0E162B] border-b border-slate-800 px-6 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider flex-shrink-0">
          <Zap className="w-4 h-4 text-amber-400" />
          <span className="hidden sm:inline">1-Click Clinical Presets:</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-0.5 flex-1">
          {presets.map((p) => {
            const isActive = activePresetId === p.id;
            const c = presetColorMap[p.color];
            return (
              <button
                key={p.id}
                onClick={() => onSelectPreset(p.id)}
                className={cn(
                  'flex-shrink-0 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-2 whitespace-nowrap cursor-pointer',
                  isActive ? c.active : c.idle
                )}
              >
                <span>{p.label}</span>
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40 font-bold opacity-90">{p.badge}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-shrink-0 text-xs font-mono font-semibold text-slate-400 bg-[#131F38] px-2.5 py-1 rounded-lg border border-slate-700">
          Audit Latency: <strong className="text-sky-400">{auditLatency}ms</strong>
        </div>
      </div>

      {/* ── 3-Column Layout ──────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-12 overflow-hidden">

        {/* ══════════════════════════════════════════════════
            LEFT COLUMN: Patient Context & CPOE Pad (3 cols)
            ══════════════════════════════════════════════════ */}
        <div className="col-span-3 border-r border-slate-800 flex flex-col overflow-hidden bg-[#0D152A]">

          {/* Patient Selector */}
          <div className="p-4 border-b border-slate-800 bg-[#131F38]">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-sky-400" />
                <span>ICU Patient Context</span>
              </label>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                {currentPatient?.department_id || 'CICU Admitted'}
              </span>
            </div>
            <select
              value={currentPatient?.patient_id || ''}
              onChange={(e) => { const pt = patients.find((p) => p.patient_id === e.target.value); if (pt) setCurrentPatient(pt); }}
              className="w-full bg-[#0B1120] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-medium focus:outline-none focus:border-sky-400 transition-colors cursor-pointer"
            >
              {patients.map((p) => (
                <option key={p.patient_id} value={p.patient_id}>
                  {p.patient_id} — {p.age}y {p.gender} | {p.department_id || 'ICU'}
                </option>
              ))}
            </select>
          </div>

          {/* Demographics Card */}
          <div className="p-4 border-b border-slate-800 text-xs space-y-3 bg-[#0B1120]/60">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <span className="text-slate-400 block text-[10px] font-medium">AGE / SEX</span>
                <span className="font-bold text-white text-xs">{currentPatient?.age || 68} {currentPatient?.gender || 'M'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] font-medium">DEPT</span>
                <span className="font-bold text-white text-xs truncate block">{currentPatient?.department || 'Cardiology'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] font-medium">PRIMARY ICD</span>
                <span className="font-mono text-sky-400 font-bold text-xs truncate block">{currentPatient?.primary_icd || 'I25.1 CAD'}</span>
              </div>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] font-medium mb-1">DOCUMENTED ALLERGIES</span>
              <div className="flex flex-wrap gap-1">
                {currentPatient?.allergies && currentPatient.allergies.length > 0 ? (
                  currentPatient.allergies.map((a, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-semibold">{a}</span>
                  ))
                ) : (
                  <span className="text-[10px] text-slate-400 italic">NKDA (No Known Drug Allergies)</span>
                )}
              </div>
            </div>
          </div>

          {/* Longitudinal Visits Timeline */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-indigo-400" />
                <span>Longitudinal Visits</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">{currentPatient?.visits?.length || 2} EHR Visits</span>
            </div>
            <div className="space-y-2">
              {(currentPatient?.visits || [
                { visit_id: 'VIS-01', admission_type: 'EMERGENCY', icd10_diagnoses: [{ code: 'I25.1', title: 'CAD' }], icd_procedures: [{ code: '00.66', title: 'PTCA' }], tolerated_meds: ['Aspirin', 'Atorvastatin'] },
                { visit_id: 'VIS-02', admission_type: 'URGENT',    icd10_diagnoses: [{ code: 'I21.0', title: 'STEMI' }], icd_procedures: [{ code: '36.06', title: 'DES Stent' }], tolerated_meds: ['Clopidogrel', 'Metoprolol'] },
              ]).map((v, i) => (
                <div key={i} className="p-3 rounded-xl bg-[#131F38] border border-slate-700/80 text-xs space-y-1.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0" />
                      Visit {i + 1}: {v.admission_type}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">{v.visit_id}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {v.icd10_diagnoses?.map((d, di) => (
                      <span key={di} className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800/60 font-mono text-[9px] font-semibold">{d.code}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Draft Prescription Pad ── */}
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <ClipboardList className="w-3.5 h-3.5 text-emerald-400" />
                  Draft Prescription ({draftMedications.length})
                </span>
                <button onClick={clearPrescription} className="text-[10px] text-slate-400 hover:text-rose-400 transition-colors font-medium cursor-pointer">
                  Clear All
                </button>
              </div>

              {/* Feedback toast */}
              {feedbackMsg && (
                <BlurFade inView delay={0} duration={0.2}>
                  <div className={cn(
                    'p-2.5 rounded-xl text-xs flex items-center justify-between border shadow-md font-medium',
                    feedbackMsg.type === 'success'
                      ? 'bg-emerald-950/90 text-emerald-200 border-emerald-600'
                      : 'bg-amber-950/90 text-amber-200 border-amber-600'
                  )}>
                    <span>{feedbackMsg.text}</span>
                    <button onClick={() => setFeedbackMsg(null)} className="text-slate-400 hover:text-white px-1">✕</button>
                  </div>
                </BlurFade>
              )}

              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={medSearchQuery}
                  onChange={(e) => setMedSearchQuery(e.target.value)}
                  placeholder="Search medication to add..."
                  className="w-full bg-[#0B1120] border border-slate-700 rounded-xl pl-9 pr-7 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-sky-400 transition-colors font-medium"
                />
                {medSearchQuery && (
                  <button onClick={() => setMedSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">✕</button>
                )}
              </div>

              {/* Autocomplete list */}
              {medSearchQuery.trim() && (
                <div className="max-h-40 overflow-y-auto space-y-1 p-1 bg-[#0B1120] border border-sky-600/80 rounded-xl shadow-2xl z-20">
                  {formulary
                    .filter((d) => d.name.toLowerCase().includes(medSearchQuery.toLowerCase()) || d.drug_id.toLowerCase().includes(medSearchQuery.toLowerCase()) || (d.atc_class_name && d.atc_class_name.toLowerCase().includes(medSearchQuery.toLowerCase())))
                    .slice(0, 8)
                    .map((d) => (
                      <button
                        key={d.drug_id}
                        onClick={() => { addDrug(d.drug_id); setMedSearchQuery(''); }}
                        className="w-full text-left p-2 rounded-lg hover:bg-emerald-950/80 border border-transparent hover:border-emerald-600 flex items-center justify-between text-xs text-slate-200 group transition-colors cursor-pointer"
                      >
                        <div>
                          <span className="font-bold text-white group-hover:text-emerald-300">{d.name}</span>
                          <span className="ml-1.5 text-[10px] text-slate-400 font-mono">[{d.atc4_code || d.drug_id}]</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white font-bold flex items-center gap-1">
                          <Plus className="w-2.5 h-2.5" /> Add
                        </span>
                      </button>
                    ))}
                </div>
              )}

              {/* Dropdown select */}
              <select
                value={selectedAddDrugId}
                onChange={(e) => { const val = e.target.value; if (val) { addDrug(val); setSelectedAddDrugId(''); } }}
                className="w-full bg-[#0B1120] border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-medium focus:outline-none focus:border-emerald-400 transition-colors cursor-pointer"
              >
                <option value="">Select medication from formulary...</option>
                {formulary.map((d) => (
                  <option key={d.drug_id} value={d.drug_id}>
                    {d.name} [{d.atc4_code || d.drug_id}] (RxCUI: {d.rxcui})
                  </option>
                ))}
              </select>

              {/* Big add button */}
              <button
                onClick={() => { if (selectedAddDrugId) addDrug(selectedAddDrugId); }}
                disabled={!selectedAddDrugId}
                className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-700/30 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{selectedAddDrugId ? `+ Add ${formulary.find((d) => d.drug_id === selectedAddDrugId)?.name || 'Medication'}` : '+ Add Selected Medication'}</span>
              </button>

              {/* Quick ICU chips */}
              <div>
                <span className="text-[10px] text-slate-300 block mb-1.5 font-bold">Quick Add — ICU Formulary</span>
                <div className="flex flex-wrap gap-1.5">
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
                      className="px-2.5 py-1 rounded-lg bg-[#131F38] hover:bg-emerald-950 border border-slate-700 hover:border-emerald-500 text-slate-200 hover:text-emerald-300 text-[10px] font-mono transition-colors flex items-center gap-1 cursor-pointer font-semibold"
                      title={`Add ${qm.name}`}
                    >
                      <Plus className="w-2.5 h-2.5 text-emerald-400" />{qm.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Draft drug list */}
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {draftMedications.map((drug, idx) => (
                  <BlurFade key={drug.drug_id} inView delay={idx * 0.03} duration={0.2}>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#131F38] border border-slate-700 text-xs shadow-sm">
                      <div className="flex items-center gap-2 truncate">
                        <span className="w-5 h-5 rounded-md bg-[#0B1120] border border-slate-700 flex items-center justify-center font-mono text-[10px] font-bold text-slate-300 flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="truncate">
                          <div className="font-bold text-white truncate flex items-center gap-1.5">
                            {drug.name}
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#0B1120] font-mono text-slate-300 border border-slate-700">
                              {drug.atc4_code || drug.drug_id}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 truncate font-medium">
                            {drug.atc_class_name || 'Therapeutic Agent'} · RxCUI {drug.rxcui}
                          </div>
                        </div>
                      </div>
                      <button onClick={() => removeDrug(drug.drug_id)} className="text-slate-400 hover:text-rose-400 p-1 transition-colors flex-shrink-0 cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </BlurFade>
                ))}
              </div>

              {/* PID Controller slider */}
              <div className="p-3.5 rounded-xl bg-[#131F38] border border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5 text-sky-400" />
                    PID Target DDI (γ)
                  </span>
                  <span className="font-mono text-xs font-bold text-sky-400 bg-[#0B1120] px-2 py-0.5 rounded border border-slate-700">
                    {pidGamma.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range" min="0.01" max="0.08" step="0.01" value={pidGamma}
                  onChange={(e) => setPidGamma(parseFloat(e.target.value))}
                  className="w-full h-2 bg-[#0B1120] rounded-lg cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 font-semibold mt-1">
                  <span>0.01 Strict</span><span>SafeDrug PID</span><span>0.08 Permissive</span>
                </div>
              </div>

              {/* Audit button */}
              <button
                onClick={runAudit}
                disabled={isAuditing || draftMedications.length === 0}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-600/30 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isAuditing ? 'Auditing Molecular Graphs...' : 'Execute Safety Firewall Audit'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            CENTER COLUMN: Alert-Fatigue Triage Engine (5 cols)
            ══════════════════════════════════════════════════ */}
        <div className="col-span-5 bg-[#0B1120] flex flex-col border-r border-slate-800 overflow-hidden">

          {/* 4 High-Impact KPI Cards */}
          <div className="p-4 grid grid-cols-4 gap-2.5 border-b border-slate-800 bg-[#0E162B]">
            {[
              { label: 'Standard Alerts', value: summary.raw_rule_alerts_count, sub: 'Rule baseline',       color: 'text-white',       bg: 'bg-[#131F38] border-slate-700' },
              { label: 'AI Suppressed',   value: `${summary.suppressed_spam_count} (${fatiguePct}%)`, sub: 'Spam avoided', color: 'text-emerald-300', bg: 'bg-emerald-950/40 border-emerald-700/60' },
              { label: 'Critical Stops',  value: summary.hard_stop_count, sub: 'Life-threatening',         color: 'text-rose-300',    bg: 'bg-rose-950/40 border-rose-700/60' },
              { label: 'DDI Risk Rate',   value: `${(summary.set_ddi_rate * 100).toFixed(1)}%`, sub: summary.set_ddi_rate > 0 ? '→ 0.0% post-swap' : 'Safe Regimen', color: 'text-sky-300', bg: 'bg-sky-950/40 border-sky-700/60' },
            ].map((kpi) => (
              <div key={kpi.label} className={cn('p-3 rounded-xl border shadow-sm', kpi.bg)}>
                <span className="text-[10px] font-semibold text-slate-300 block mb-1 uppercase tracking-wider">{kpi.label}</span>
                <div className={cn('text-lg font-extrabold font-mono', kpi.color)}>{kpi.value}</div>
                <span className="text-[9px] text-slate-400 mt-0.5 block font-medium">{kpi.sub}</span>
              </div>
            ))}
          </div>

          {/* Triage Feed Filter Chips */}
          <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between bg-[#0D152A]">
            <div className="flex items-center gap-1 bg-[#131F38] border border-slate-700 p-1 rounded-xl text-xs">
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
                    'px-3 py-1 rounded-lg font-bold transition-all cursor-pointer',
                    alertFilter === f.id ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  )}
                >{f.label}</button>
              ))}
            </div>
            <span className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-sky-400" /> Poly et al. Triage
            </span>
          </div>

          {/* Alert Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {filteredAlerts.length === 0 ? (
              <div className="p-10 text-center rounded-2xl bg-[#131F38] border border-slate-700 text-xs text-slate-300">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                No drug interactions in this category. Regimen is safe.
              </div>
            ) : (
              filteredAlerts.map((alert, idx) => {
                const isSelected = selectedAlert?.alert_id === alert.alert_id;
                const isCrit     = alert.alert_tier === 'HARD_STOP_CRITICAL';
                const isWarn     = alert.alert_tier === 'PASSIVE_INLINE_WARNING';
                const acceptPct  = Math.round(alert.acceptance_probability * 100);
                const overridePct = Math.round(alert.override_probability * 100);

                return (
                  <BlurFade key={idx} inView delay={idx * 0.04} duration={0.25}>
                    <div
                      onClick={() => inspectClash(alert)}
                      className={cn(
                        'p-4 rounded-2xl border transition-all cursor-pointer text-xs space-y-3 shadow-md',
                        isSelected
                          ? isCrit  ? 'bg-rose-950/50 border-rose-400 ring-2 ring-rose-400/50 shadow-lg shadow-rose-950/60'
                                    : 'bg-amber-950/50 border-amber-400 ring-2 ring-amber-400/50 shadow-lg shadow-amber-950/60'
                          : isCrit  ? 'bg-[#181528] border-rose-700/80 hover:border-rose-400 hover:bg-rose-950/30'
                          : isWarn  ? 'bg-[#1C1A24] border-amber-700/80 hover:border-amber-400 hover:bg-amber-950/30'
                                    : 'bg-[#131F38] border-slate-700/80 opacity-75 hover:opacity-100 hover:border-slate-500'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="font-extrabold text-sm text-white flex items-center gap-2 truncate">
                          <span className={isCrit ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-slate-200'}>{alert.drug_a}</span>
                          <span className="text-slate-500 font-normal">+</span>
                          <span className={isCrit ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-slate-200'}>{alert.drug_b}</span>
                        </div>
                        <span className={cn(
                          'px-2.5 py-1 rounded-md text-[10px] font-extrabold uppercase tracking-wider border flex items-center gap-1 flex-shrink-0',
                          isCrit ? 'bg-rose-500/20 text-rose-200 border-rose-500/50'
                          : isWarn ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                                   : 'bg-slate-800 text-slate-300 border-slate-600'
                        )}>
                          {isCrit ? <><AlertOctagon className="w-3.5 h-3.5 text-rose-400" />HARD STOP</>
                           : isWarn ? <><AlertTriangle className="w-3.5 h-3.5 text-amber-400" />WARNING</>
                                    : <><BellOff className="w-3.5 h-3.5 text-slate-400" />SUPPRESSED</>}
                        </span>
                      </div>
                      <div className="text-xs text-slate-200 font-medium leading-relaxed">
                        <span className="text-amber-300 font-bold">{alert.twosides_effect}:</span> {alert.mechanism}
                      </div>

                      {/* Confidence Bars */}
                      <div className="space-y-1.5 pt-1 border-t border-slate-700/60">
                        <div className="flex justify-between text-[11px] font-semibold">
                          <span className="text-emerald-400">Acceptance: {acceptPct}%</span>
                          <span className="text-amber-400">Override: {overridePct}%</span>
                        </div>
                        <div className="w-full bg-[#0B1120] h-2 rounded-full overflow-hidden flex border border-slate-700">
                          <div className="bg-emerald-500 h-full transition-all" style={{ width: `${acceptPct}%` }} />
                          <div className="bg-amber-500 h-full transition-all" style={{ width: `${overridePct}%` }} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-300 font-mono font-medium pt-0.5">
                        <span>Epistemic Uncertainty: <strong className="text-sky-300">{alert.epistemic_uncertainty.toFixed(3)}</strong></span>
                        <span>BRICS Cos: <strong className={alert.brics_cosine_sim < 0 ? 'text-emerald-400' : 'text-rose-400'}>{alert.brics_cosine_sim.toFixed(3)}</strong></span>
                      </div>
                    </div>
                  </BlurFade>
                );
              })
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════════════
            RIGHT COLUMN: 2D Molecular Clash Inspector (4 cols)
            ══════════════════════════════════════════════════ */}
        <div className="col-span-4 flex flex-col overflow-hidden bg-[#0D152A]">
          <div className="p-4 border-b border-slate-800 bg-[#131F38] flex items-center justify-between">
            <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Atom className="w-4 h-4 text-rose-400" />
              <span>RDKit 2D Molecular Clash Inspector</span>
            </span>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 font-mono font-bold">
              MCS Crimson #EB3838
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {selectedAlert ? (
              <>
                {/* Side-by-side molecules with crisp white vector canvases */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: selectedAlert.drug_a, id: selectedAlert.drug_a_id || '', svg: molASvg, props: molAProps, idColor: 'text-sky-400' },
                    { label: selectedAlert.drug_b, id: selectedAlert.drug_b_id || '', svg: molBSvg, props: molBProps, idColor: 'text-rose-400' },
                  ].map((mol, mi) => (
                    <BlurFade key={mi} inView delay={mi * 0.08} duration={0.3}>
                      <div className="bg-[#131F38] rounded-2xl border border-slate-700/80 p-3.5 flex flex-col shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-extrabold text-xs text-white truncate">{mol.label}</span>
                          <span className={cn('text-[10px] font-mono font-bold', mol.idColor)}>{mol.id}</span>
                        </div>

                        {/* Pristine white lab canvas: guarantees 100% visible black bonds and colored heteroatoms */}
                        <div
                          className="svg-container h-44 bg-white rounded-xl flex items-center justify-center p-2 border border-slate-200 shadow-inner"
                          dangerouslySetInnerHTML={{ __html: mol.svg || '<span class="text-xs text-slate-400 font-mono">Rendering...</span>' }}
                        />

                        <div className="mt-2.5 text-[10px] text-slate-300 space-y-1 font-medium">
                          {[
                            ['Mol Wt', mol.props.mw.toFixed(2)],
                            ['LogP',   mol.props.logp.toFixed(2)],
                            ['TPSA',   mol.props.tpsa.toFixed(1)],
                          ].map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="text-slate-400">{k}:</span>
                              <span className="font-mono text-white font-bold">{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </BlurFade>
                  ))}
                </div>

                {/* Substructure Clash Banner */}
                <BlurFade inView delay={0.12} duration={0.3}>
                  <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-600/60 text-xs shadow-md">
                    <div className="flex items-center justify-between text-rose-300 font-bold mb-1.5">
                      <span className="flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-rose-400" />
                        <span>Reactive Substructure Overlap</span>
                      </span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-rose-900 text-white font-bold border border-rose-500/50">
                        {sharedAtomsCount} Shared MCS Atoms
                      </span>
                    </div>
                    <p className="text-slate-200 text-xs leading-relaxed font-medium">{selectedAlert.mechanism}</p>
                  </div>
                </BlurFade>

                {/* Safe ATC substitute card */}
                {activeSubstitute && (
                  <BlurFade inView delay={0.2} duration={0.3}>
                    <div className="p-4 rounded-2xl bg-[#10242B] border border-emerald-600/70 space-y-3 shadow-lg">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          Recommended Safe Substitute
                        </span>
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-bold">
                          D_i,j' = 0 Verified
                        </span>
                      </div>
                      <div className="bg-[#0B1120] p-3.5 rounded-xl border border-emerald-800/60 space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[10px] text-slate-400 block font-semibold">REPLACE WITH</span>
                            <span className="text-sm font-extrabold text-white">
                              {activeSubstitute.substitute_name} [{activeSubstitute.substitute_drug_id || activeSubstitute.substitute_id}]
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block font-semibold">THERAPEUTIC CLASS</span>
                            <span className="text-xs text-emerald-400 font-bold">{activeSubstitute.atc_class || 'Same ATC-3 Family'}</span>
                          </div>
                        </div>
                        <p className="text-slate-200 text-xs leading-relaxed font-medium">{activeSubstitute.clinical_rationale || activeSubstitute.reason}</p>
                        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] text-slate-300 font-medium">
                          <span>Pre-swap DDI: <strong className="text-rose-400 font-mono">{(summary.set_ddi_rate * 100).toFixed(1)}%</strong></span>
                          <ArrowRight className="w-4 h-4 text-emerald-400" />
                          <span>Post-swap DDI: <strong className="text-emerald-400 font-mono">0.0%</strong></span>
                        </div>
                      </div>
                      <button
                        onClick={applySafeSubstitution}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-700/40 cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Replace {activeSubstitute.replace_drug_name || activeSubstitute.original_drug_name} with {activeSubstitute.substitute_name}</span>
                      </button>
                    </div>
                  </BlurFade>
                )}
              </>
            ) : (
              <div className="text-center py-24 text-slate-400 text-xs">
                <Atom className="w-12 h-12 mx-auto mb-3 text-slate-500" />
                Select a drug-drug interaction alert from the center triage feed to inspect live 2D chemical structures.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
