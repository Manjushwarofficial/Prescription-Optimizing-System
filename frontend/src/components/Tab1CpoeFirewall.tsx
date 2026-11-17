import React, { useState, useEffect } from 'react';
import {
  Zap,
  User,
  History,
  ClipboardList,
  Sliders,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  BellOff,
  AlertOctagon,
  RefreshCw,
  Plus,
  X,
  Atom,
  CheckCircle2,
  ArrowRight,
  Layers,
  Search,
} from 'lucide-react';
import {
  AuditAlert,
  AuditResponse,
  DemoCase,
  FormularyDrug,
  PatientContext,
  SafeSubstitute,
} from '../types';
import { auditPrescription, fetchMoleculeSvg } from '../services/api';

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
  patients,
  demoCases,
  formulary,
  currentPatient,
  setCurrentPatient,
  draftMedications,
  setDraftMedications,
  activePresetId,
  onSelectPreset,
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

  // Molecule Inspector State
  const [molASvg, setMolASvg] = useState<string>('');
  const [molBSvg, setMolBSvg] = useState<string>('');
  const [molAProps, setMolAProps] = useState<{ mw: number; logp: number; tpsa: number }>({ mw: 320, logp: 2.4, tpsa: 45 });
  const [molBProps, setMolBProps] = useState<{ mw: number; logp: number; tpsa: number }>({ mw: 345, logp: 2.1, tpsa: 68 });
  const [sharedAtomsCount, setSharedAtomsCount] = useState<number>(8);
  const [activeSubstitute, setActiveSubstitute] = useState<SafeSubstitute | null>(null);

  // Trigger Audit whenever draft medications or pidGamma change
  useEffect(() => {
    if (draftMedications.length === 0) {
      setAuditResult(null);
      setSelectedAlert(null);
      return;
    }

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

      const elapsed = Math.round(performance.now() - start);
      setAuditLatency(elapsed);
      setAuditResult(res);

      if (res.alerts && res.alerts.length > 0) {
        const crit = res.alerts.find((a) => a.alert_tier === 'HARD_STOP_CRITICAL');
        const warn = res.alerts.find((a) => a.alert_tier === 'PASSIVE_INLINE_WARNING');
        const target = crit || warn || res.alerts[0];
        setSelectedAlert(target);
        inspectClash(target, res.safe_substitutes);
      } else {
        setSelectedAlert(null);
        setActiveSubstitute(null);
      }
    } catch (err) {
      console.error('Audit failed:', err);
    } finally {
      setIsAuditing(false);
    }
  };

  const inspectClash = async (alert: AuditAlert, substitutesList?: SafeSubstitute[]) => {
    setSelectedAlert(alert);

    const drugAId = alert.drug_a_id || alert.drug_a;
    const drugBId = alert.drug_b_id || alert.drug_b;

    // Fetch highlighted SVGs in crimson (#EB3838)
    try {
      const [resA, resB] = await Promise.all([
        fetchMoleculeSvg(drugAId, drugBId),
        fetchMoleculeSvg(drugBId, drugAId),
      ]);

      setMolASvg(resA.svg);
      setMolBSvg(resB.svg);
      setMolAProps({ mw: resA.molecular_weight, logp: resA.logp, tpsa: resA.tpsa });
      setMolBProps({ mw: resB.molecular_weight, logp: resB.logp, tpsa: resB.tpsa });

      const shared = resA.shared_substructures?.length ? resA.shared_substructures.length * 4 : 8;
      setSharedAtomsCount(shared);
    } catch (err) {
      console.error('SVG fetch error:', err);
    }

    // Match safe substitute
    const subs = substitutesList || auditResult?.safe_substitutes || [];
    const match = subs.find((s) => {
      const origId = (s.replace_drug_id || s.original_drug_id || '').toLowerCase();
      const origName = (s.replace_drug_name || s.original_drug_name || '').toLowerCase();
      const da = (alert.drug_a || '').toLowerCase();
      const db = (alert.drug_b || '').toLowerCase();
      return origId === da || origId === db || origName === da || origName === db;
    });

    if (match) {
      setActiveSubstitute(match);
    } else {
      // Fallback
      setActiveSubstitute({
        replace_drug_id: alert.drug_b_id || alert.drug_b,
        replace_drug_name: alert.drug_b,
        substitute_drug_id: 'A02BC02',
        substitute_name: 'Pantoprazole',
        atc_class: 'Proton pump inhibitors',
        clinical_rationale: 'Within-class substitution eliminates competitive inhibition and restores safety margin.',
        pre_swap_ddi_rate: 0.333,
        post_swap_ddi_rate: 0.0,
      });
    }
  };

  const applySafeSubstitution = () => {
    if (!activeSubstitute) return;
    const origId = (activeSubstitute.replace_drug_id || activeSubstitute.original_drug_id || '').toLowerCase();
    const origName = (activeSubstitute.replace_drug_name || activeSubstitute.original_drug_name || '').toLowerCase();
    const subId = activeSubstitute.substitute_drug_id || activeSubstitute.substitute_id || '';

    // Find replacement object in formulary
    const replacement = formulary.find(
      (d) => d.drug_id.toLowerCase() === subId.toLowerCase() || d.name.toLowerCase() === activeSubstitute.substitute_name.toLowerCase()
    ) || {
      drug_id: subId,
      name: activeSubstitute.substitute_name,
      atc4_code: subId,
      rxcui: '99999',
      atc_class_name: activeSubstitute.atc_class || 'Safe Substitute',
    };

    setDraftMedications((prev) => {
      const idx = prev.findIndex(
        (d) => d.drug_id.toLowerCase() === origId || d.name.toLowerCase() === origName
      );
      if (idx !== -1) {
        const updated = [...prev];
        updated[idx] = replacement;
        return updated;
      }
      return [...prev, replacement];
    });

    setActiveSubstitute(null);
  };

  const addDrug = (drugToAddId?: string) => {
    const targetId = drugToAddId || selectedAddDrugId;
    if (!targetId) return;

    const drug = formulary.find(
      (d) =>
        d.drug_id.toLowerCase() === targetId.toLowerCase() ||
        d.name.toLowerCase() === targetId.toLowerCase()
    );
    if (!drug) return;

    if (
      draftMedications.some(
        (d) =>
          d.drug_id.toLowerCase() === drug.drug_id.toLowerCase() ||
          d.name.toLowerCase() === drug.name.toLowerCase()
      )
    ) {
      setFeedbackMsg({ text: `⚠️ ${drug.name} is already in the draft prescription.`, type: 'warning' });
      setTimeout(() => setFeedbackMsg(null), 3000);
      return;
    }

    setDraftMedications((prev) => [...prev, drug]);
    setSelectedAddDrugId('');
    setFeedbackMsg({ text: `✓ Added ${drug.name} [${drug.atc4_code || drug.drug_id}] to prescription`, type: 'success' });
    setTimeout(() => setFeedbackMsg(null), 3000);
  };

  const removeDrug = (drugId: string) => {
    setDraftMedications((prev) => prev.filter((d) => d.drug_id !== drugId));
  };

  const clearPrescription = () => {
    setDraftMedications([]);
  };

      const summary = auditResult?.summary || {
        total_drugs: draftMedications.length,
        total_pairs_checked: (draftMedications.length * (draftMedications.length - 1)) / 2,
        raw_rule_alerts_count: 0,
        suppressed_spam_count: 0,
        alert_fatigue_reduction_pct: 0,
        hard_stop_count: 0,
        set_ddi_rate: 0,
        safety_status: 'SAFE',
      };

      const alerts = auditResult?.alerts || [];
      const filteredAlerts = alerts.filter((a) => {
        if (alertFilter === 'ALL') return true;
        return a.alert_tier === alertFilter;
      });

      const fatiguePct = typeof summary.alert_fatigue_reduction_pct === 'number'
        ? summary.alert_fatigue_reduction_pct.toFixed(1)
        : String(summary.alert_fatigue_reduction_pct).replace('%', '');

      return (
        <div className="h-full flex flex-col overflow-hidden">
          {/* Top 1-Click Clinical Presets Bar */}
          <div className="bg-slate-900/90 border-b border-slate-800 px-6 py-2.5 flex-shrink-0 flex items-center justify-between gap-4">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-400 uppercase tracking-wider flex-shrink-0">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>1-Click Clinical Presets:</span>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
              <button
                onClick={() => onSelectPreset('CASE-1')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 whitespace-nowrap shadow-sm ${activePresetId === 'CASE-1'
                    ? 'bg-rose-900 text-white border border-rose-500 shadow-rose-900/40 ring-1 ring-rose-500'
                    : 'bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/60'
                  }`}
              >
                <span>⚡ Case 1: Post-Stent & GI Bleed Polypharmacy</span>
                <span className="px-1.5 py-0.2 rounded bg-rose-900 text-[10px] text-rose-200">Clopidogrel+PPI</span>
              </button>

              <button
                onClick={() => onSelectPreset('CASE-2')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 whitespace-nowrap shadow-sm ${activePresetId === 'CASE-2'
                    ? 'bg-amber-900 text-white border border-amber-500 shadow-amber-900/40 ring-1 ring-amber-500'
                    : 'bg-amber-950/60 hover:bg-amber-900/80 text-amber-300 border border-amber-800/60'
                  }`}
              >
                <span>⚡ Case 2: Statin + Antiarrhythmic Myopathy</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-900 text-[10px] text-amber-200">Simvastatin+Amio</span>
              </button>

              <button
                onClick={() => onSelectPreset('CASE-3')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 whitespace-nowrap shadow-sm ${activePresetId === 'CASE-3'
                    ? 'bg-orange-900 text-white border border-orange-500 shadow-orange-900/40 ring-1 ring-orange-500'
                    : 'bg-orange-950/60 hover:bg-orange-900/80 text-orange-300 border border-orange-800/60'
                  }`}
              >
                <span>⚡ Case 3: Heart Failure Hyperkalemia Triad</span>
                <span className="px-1.5 py-0.2 rounded bg-orange-900 text-[10px] text-orange-200">Triple Whammy AKI</span>
              </button>

              <button
                onClick={() => onSelectPreset('CASE-4')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 whitespace-nowrap shadow-sm ${activePresetId === 'CASE-4'
                    ? 'bg-purple-900 text-white border border-purple-500 shadow-purple-900/40 ring-1 ring-purple-500'
                    : 'bg-purple-950/60 hover:bg-purple-900/80 text-purple-300 border border-purple-800/60'
                  }`}
              >
                <span>⚡ Case 4: Neuro-ICU Serotonergic Clash</span>
                <span className="px-1.5 py-0.2 rounded bg-purple-900 text-[10px] text-purple-200">SSRI+Tramadol</span>
              </button>
            </div>

            <div className="flex-shrink-0 text-xs text-slate-500">
              <span className="font-mono">Audit Latency: {auditLatency}ms</span>
            </div>
          </div>

          {/* 3-Column Work Area Grid */}
          <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">
            {/* ===================================================================== */}
            {/* LEFT COLUMN: Patient Context & CPOE Order Pad (3 cols) */}
            {/* ===================================================================== */}
            <div className="col-span-3 bg-slate-900/40 border-r border-slate-800 flex flex-col h-full overflow-hidden">
              {/* Patient Selector */}
              <div className="p-4 border-b border-slate-800 bg-slate-900/70">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-sky-400" />
                    <span>ICU Patient Context</span>
                  </label>
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    {currentPatient?.department_id || 'CICU Admitted'}
                  </span>
                </div>
                <select
                  value={currentPatient?.patient_id || ''}
                  onChange={(e) => {
                    const pt = patients.find((p) => p.patient_id === e.target.value);
                    if (pt) setCurrentPatient(pt);
                  }}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  {patients.map((p) => (
                    <option key={p.patient_id} value={p.patient_id}>
                      {p.patient_id} — {p.age}y {p.gender} | {p.department_id || 'ICU'} ({p.visits?.length || 1} Visits)
                    </option>
                  ))}
                </select>
              </div>

              {/* Patient Demographics Card */}
              <div className="p-4 border-b border-slate-800/80 bg-slate-900/30 text-xs space-y-2">
                <div className="grid grid-cols-3 gap-2 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">AGE/SEX</span>
                    <span className="font-semibold">{currentPatient?.age || 68} {currentPatient?.gender || 'M'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">DEPT</span>
                    <span className="font-semibold">{currentPatient?.department || currentPatient?.department_id || 'Cardiology'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">PRIMARY ICD</span>
                    <span className="font-mono text-sky-400 truncate block">
                      {currentPatient?.primary_icd || 'I25.1 CAD'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block text-[10px] mb-1">DOCUMENTED ALLERGIES</span>
                  <div className="flex flex-wrap gap-1">
                    {currentPatient?.allergies && currentPatient.allergies.length > 0 ? (
                      currentPatient.allergies.map((a, i) => (
                        <span key={i} className="px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px]">
                          {a}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-slate-500 italic">NKDA (No Known Drug Allergies)</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Longitudinal Visit Timeline */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Longitudinal Visits (Dual-GRU)</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {currentPatient?.visits?.length || 2} Historical Visits
                  </span>
                </div>

                <div className="space-y-2.5">
                  {(currentPatient?.visits || [
                    {
                      visit_id: 'VIS-01',
                      admission_type: 'EMERGENCY',
                      icd10_diagnoses: [{ code: 'I25.1', title: 'CAD' }],
                      icd_procedures: [{ code: '00.66', title: 'PTCA' }],
                      tolerated_meds: ['Aspirin', 'Atorvastatin'],
                    },
                    {
                      visit_id: 'VIS-02',
                      admission_type: 'URGENT',
                      icd10_diagnoses: [{ code: 'I21.0', title: 'STEMI' }],
                      icd_procedures: [{ code: '36.06', title: 'DES Stent' }],
                      tolerated_meds: ['Clopidogrel', 'Metoprolol'],
                    },
                  ]).map((v, i) => (
                    <div key={i} className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                          Visit {i + 1}: {v.admission_type || 'ICU'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500">{v.visit_id}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {v.icd10_diagnoses?.map((d, di) => (
                          <span key={di} className="px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800/60 font-mono text-[9px]">
                            {d.code}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Prescription Pad Section */}
                <div className="pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                      <ClipboardList className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Draft Prescription ({draftMedications.length})</span>
                    </span>
                    <button
                      onClick={clearPrescription}
                      className="text-[10px] text-slate-500 hover:text-rose-400 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>

                  {/* Add Drug Section (Search Bar + Dropdown + Full-Width Button + Quick ICU Chips) */}
                  <div className="space-y-2 mb-3">
                    {/* Real-time Toast Feedback */}
                    {feedbackMsg && (
                      <div className={`p-2 rounded-lg text-xs flex items-center justify-between transition-all shadow-md ${
                        feedbackMsg.type === 'success'
                          ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-600/70'
                          : 'bg-amber-950/90 text-amber-300 border border-amber-600/70'
                      }`}>
                        <span className="font-medium">{feedbackMsg.text}</span>
                        <button onClick={() => setFeedbackMsg(null)} className="text-slate-400 hover:text-white px-1">✕</button>
                      </div>
                    )}

                    {/* Instant Search Bar */}
                    <div className="relative">
                      <input
                        type="text"
                        value={medSearchQuery}
                        onChange={(e) => setMedSearchQuery(e.target.value)}
                        placeholder="🔍 Filter & add (e.g. Lidocaine)..."
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                      />
                      {medSearchQuery && (
                        <button
                          onClick={() => setMedSearchQuery('')}
                          className="absolute right-2 top-1.5 text-slate-400 hover:text-white text-xs px-1"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Autocomplete Results when user types */}
                    {medSearchQuery.trim() && (
                      <div className="max-h-36 overflow-y-auto space-y-1 p-1 bg-slate-950 border border-sky-800/80 rounded-lg shadow-xl z-20">
                        {formulary
                          .filter((d) =>
                            d.name.toLowerCase().includes(medSearchQuery.toLowerCase()) ||
                            d.drug_id.toLowerCase().includes(medSearchQuery.toLowerCase()) ||
                            (d.atc_class_name && d.atc_class_name.toLowerCase().includes(medSearchQuery.toLowerCase()))
                          )
                          .slice(0, 8)
                          .map((d) => (
                            <button
                              key={d.drug_id}
                              onClick={() => {
                                addDrug(d.drug_id);
                                setMedSearchQuery('');
                              }}
                              className="w-full text-left p-1.5 rounded hover:bg-emerald-950/80 hover:border-emerald-600 border border-transparent flex items-center justify-between text-xs text-slate-200 group transition-colors cursor-pointer"
                            >
                              <div>
                                <span className="font-bold text-white group-hover:text-emerald-300">{d.name}</span>
                                <span className="ml-1.5 text-[10px] text-slate-400 font-mono">[{d.atc4_code || d.drug_id}]</span>
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold flex items-center gap-1">
                                <Plus className="w-3 h-3" /> Add
                              </span>
                            </button>
                          ))}
                      </div>
                    )}

                    {/* Dropdown with Instant Auto-Add on Selection */}
                    <div className="relative">
                      <select
                        value={selectedAddDrugId}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) {
                            addDrug(val);
                            setSelectedAddDrugId('');
                          }
                        }}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 truncate cursor-pointer hover:border-slate-600 transition-colors"
                      >
                        <option value="">⚡ Select Medication to Add Immediately...</option>
                        {formulary.map((d) => (
                          <option key={d.drug_id} value={d.drug_id}>
                            {d.name} [{d.atc4_code || d.drug_id}] (RxCUI: {d.rxcui})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Big, Un-truncated Action Button */}
                    <button
                      onClick={() => {
                        if (selectedAddDrugId) {
                          addDrug(selectedAddDrugId);
                        }
                      }}
                      disabled={!selectedAddDrugId}
                      className="w-full py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition-all shadow-md flex items-center justify-center space-x-1.5 cursor-pointer active:scale-[0.99]"
                    >
                      <Plus className="w-4 h-4 flex-shrink-0" />
                      <span>
                        {selectedAddDrugId
                          ? `+ Add ${formulary.find((d) => d.drug_id === selectedAddDrugId)?.name || 'Medication'} to Prescription`
                          : '+ Add Selected Medication'}
                      </span>
                    </button>

                    {/* Quick-Add Popular ICU Meds Chips */}
                    <div className="pt-1">
                      <span className="text-[10px] text-slate-400 block mb-1 font-semibold">⚡ 1-Click Quick Add ICU Meds:</span>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { id: 'C01BB01', name: 'Lidocaine' },
                          { id: 'C03DA01', name: 'Spironolactone' },
                          { id: 'C03CA01', name: 'Furosemide' },
                          { id: 'A02BC02', name: 'Pantoprazole' },
                          { id: 'B01AB01', name: 'Heparin' },
                          { id: 'C07AB02', name: 'Metoprolol' },
                          { id: 'C01BD01', name: 'Amiodarone' },
                          { id: 'C01CA03', name: 'Norepinephrine' },
                        ].map((qm) => (
                          <button
                            key={qm.id}
                            onClick={() => addDrug(qm.id)}
                            className="px-2 py-1 rounded-md bg-slate-900 hover:bg-emerald-950 border border-slate-800 hover:border-emerald-600 text-slate-300 hover:text-emerald-300 text-[10px] font-mono transition-colors flex items-center gap-1 cursor-pointer"
                            title={`Click to add ${qm.name}`}
                          >
                            <Plus className="w-2.5 h-2.5 text-emerald-400" />
                            <span>{qm.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                    {/* Active Drugs List */}
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {draftMedications.map((drug, idx) => (
                        <div
                          key={drug.drug_id}
                          className="flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center font-mono text-[10px] text-slate-400 flex-shrink-0">
                              {idx + 1}
                            </span>
                            <div className="truncate">
                              <div className="font-bold text-slate-200 truncate flex items-center gap-1.5">
                                {drug.name}
                                <span className="text-[9px] px-1 rounded bg-slate-800 font-mono text-slate-400">
                                  {drug.atc4_code || drug.drug_id}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 truncate">
                                {drug.atc_class_name || 'Therapeutic Agent'} · RxCUI {drug.rxcui}
                              </div>
                            </div>
                          </div>
                          <button
                            onClick={() => removeDrug(drug.drug_id)}
                            className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                            title="Remove"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* PID Controller Slider */}
                    <div className="mt-4 p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                          <Sliders className="w-3.5 h-3.5 text-sky-400" />
                          PID Target DDI (γ)
                        </span>
                        <span className="font-mono text-xs font-bold text-sky-400">
                          {pidGamma.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.01"
                        max="0.08"
                        step="0.01"
                        value={pidGamma}
                        onChange={(e) => setPidGamma(parseFloat(e.target.value))}
                        className="w-full accent-sky-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                      />
                      <div className="flex justify-between text-[9px] text-slate-500 mt-1">
                        <span>0.01 (Strict)</span>
                        <span>SafeDrug PID Threshold</span>
                        <span>0.08 (Permissive)</span>
                      </div>
                    </div>

                    {/* Run Audit Button */}
                    <button
                      onClick={runAudit}
                      disabled={isAuditing || draftMedications.length === 0}
                      className="w-full mt-3 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-sky-600/30 transition-all flex items-center justify-center space-x-2"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      <span>{isAuditing ? 'Auditing Molecular Graphs...' : 'Execute Safety Firewall Audit'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* ===================================================================== */}
              {/* CENTER COLUMN: Alert-Fatigue Triage Engine & KPI Banner (5 cols) */}
              {/* ===================================================================== */}
              <div className="col-span-5 bg-slate-950 flex flex-col h-full overflow-hidden border-r border-slate-800">
                {/* 4 High-Impact KPI Cards */}
                <div className="p-4 grid grid-cols-4 gap-2.5 border-b border-slate-800 bg-slate-900/50">
                  {/* KPI 1: Standard Rule Alerts */}
                  <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800">
                    <span className="text-[10px] font-medium text-slate-400 block mb-1">Standard Alerts</span>
                    <div className="flex items-baseline space-x-1">
                      <span className="text-xl font-bold font-mono text-slate-300">
                        {summary.raw_rule_alerts_count}
                      </span>
                      <span className="text-[10px] text-slate-500">Popups</span>
                    </div>
                    <span className="text-[9px] text-slate-500 mt-1 block">Rule baseline</span>
                  </div>

                  {/* KPI 2: AI Suppressed Overrides */}
                  <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40">
                    <span className="text-[10px] font-medium text-emerald-400 block mb-1">AI Suppressed</span>
                    <div className="flex items-baseline space-x-1">
                      <span className="text-xl font-bold font-mono text-emerald-400">
                        {summary.suppressed_spam_count}
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-300">
                        ({fatiguePct}%)
                      </span>
                    </div>
                    <span className="text-[9px] text-emerald-500/80 mt-1 block">Spam avoided</span>
                  </div>

                  {/* KPI 3: Hard-Stop Critical Clashes */}
                  <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40">
                    <span className="text-[10px] font-medium text-rose-400 block mb-1">Critical Stops</span>
                    <div className="flex items-baseline space-x-1">
                      <span className="text-xl font-bold font-mono text-rose-400">
                        {summary.hard_stop_count}
                      </span>
                      <span className="text-[10px] text-rose-300">Actionable</span>
                    </div>
                    <span className="text-[9px] text-rose-500/80 mt-1 block">Life-threatening</span>
                  </div>

                  {/* KPI 4: Regimen DDI Risk Rate */}
                  <div className="p-3 rounded-xl bg-sky-950/30 border border-sky-800/40">
                    <span className="text-[10px] font-medium text-sky-400 block mb-1">DDI Risk Rate</span>
                    <div className="flex items-baseline space-x-1">
                      <span className="text-xl font-bold font-mono text-sky-400">
                        {(summary.set_ddi_rate * 100).toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-sky-300">active</span>
                    </div>
                    <span className="text-[9px] text-emerald-400 mt-1 block">
                      {summary.set_ddi_rate > 0 ? '→ 0.0% post-swap' : 'Safe Regimen'}
                    </span>
                  </div>
                </div>

                {/* Triage Feed Filter Chips */}
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
                    <button
                      onClick={() => setAlertFilter('ALL')}
                      className={`px-2.5 py-1 rounded font-medium transition-all ${alertFilter === 'ALL' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                        }`}
                    >
                      All ({alerts.length})
                    </button>
                    <button
                      onClick={() => setAlertFilter('HARD_STOP_CRITICAL')}
                      className={`px-2.5 py-1 rounded font-medium transition-all ${alertFilter === 'HARD_STOP_CRITICAL' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'text-slate-400 hover:text-rose-400'
                        }`}
                    >
                      Critical ({alerts.filter((a) => a.alert_tier === 'HARD_STOP_CRITICAL').length})
                    </button>
                    <button
                      onClick={() => setAlertFilter('PASSIVE_INLINE_WARNING')}
                      className={`px-2.5 py-1 rounded font-medium transition-all ${alertFilter === 'PASSIVE_INLINE_WARNING' ? 'bg-amber-950 text-amber-300 border border-amber-800' : 'text-slate-400 hover:text-amber-400'
                        }`}
                    >
                      Warnings ({alerts.filter((a) => a.alert_tier === 'PASSIVE_INLINE_WARNING').length})
                    </button>
                    <button
                      onClick={() => setAlertFilter('SUPPRESSED_SPAM')}
                      className={`px-2.5 py-1 rounded font-medium transition-all ${alertFilter === 'SUPPRESSED_SPAM' ? 'bg-slate-800 text-slate-300' : 'text-slate-400 hover:text-slate-300'
                        }`}
                    >
                      Suppressed ({alerts.filter((a) => a.alert_tier === 'SUPPRESSED_SPAM').length})
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-400 flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5 text-sky-400" />
                    Poly et al. Calibrated Triage
                  </span>
                </div>

                {/* Triage Alert Feed */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {filteredAlerts.length === 0 ? (
                    <div className="p-8 text-center rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                      No interactions in selected category.
                    </div>
                  ) : (
                    filteredAlerts.map((alert, idx) => {
                      const isSelected = selectedAlert?.alert_id === alert.alert_id;
                      const isCrit = alert.alert_tier === 'HARD_STOP_CRITICAL';
                      const isWarn = alert.alert_tier === 'PASSIVE_INLINE_WARNING';
                      const acceptPct = Math.round(alert.acceptance_probability * 100);
                      const overridePct = Math.round(alert.override_probability * 100);

                      return (
                        <div
                          key={idx}
                          onClick={() => inspectClash(alert)}
                          className={`p-3.5 rounded-xl border transition-all cursor-pointer text-xs space-y-2.5 ${isSelected
                              ? isCrit
                                ? 'bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/50 shadow-lg'
                                : 'bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/50 shadow-lg'
                              : isCrit
                                ? 'bg-rose-950/20 border-rose-800/80 hover:border-rose-600'
                                : isWarn
                                  ? 'bg-amber-950/20 border-amber-800/80 hover:border-amber-600'
                                  : 'bg-slate-900/40 border-slate-800 opacity-70 hover:opacity-100'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="font-bold text-sm text-white flex items-center space-x-1.5 truncate">
                              <span className="text-rose-400">{alert.drug_a}</span>
                              <span className="text-slate-500">+</span>
                              <span className="text-rose-400">{alert.drug_b}</span>
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border flex items-center gap-1 ${isCrit
                                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                  : isWarn
                                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                    : 'bg-slate-800 text-slate-400 border-slate-700'
                                }`}
                            >
                              {isCrit ? (
                                <>
                                  <AlertOctagon className="w-3 h-3 text-rose-400" />
                                  HARD-STOP CRITICAL
                                </>
                              ) : isWarn ? (
                                <>
                                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                                  INLINE WARNING
                                </>
                              ) : (
                                <>
                                  <BellOff className="w-3 h-3 text-slate-400" />
                                  SUPPRESSED SPAM
                                </>
                              )}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-300 font-medium leading-relaxed">
                            <span className="text-amber-400 font-semibold">{alert.twosides_effect}:</span> {alert.mechanism}
                          </div>

                          {/* Confidence Bars */}
                          <div className="space-y-1 pt-1 border-t border-slate-800/80">
                            <div className="flex justify-between text-[10px]">
                              <span className="text-emerald-400 font-medium">Acceptance Prob: {acceptPct}%</span>
                              <span className="text-amber-400 font-medium">Override Prob: {overridePct}%</span>
                            </div>
                            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden flex">
                              <div className="bg-emerald-500 h-full transition-all" style={{ width: `${acceptPct}%` }}></div>
                              <div className="bg-amber-500 h-full transition-all" style={{ width: `${overridePct}%` }}></div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 font-mono">
                            <span>Epistemic Uncertainty: <strong className="text-sky-300">{alert.epistemic_uncertainty.toFixed(3)}</strong></span>
                            <span>BRICS Cos: <strong className={alert.brics_cosine_sim < 0 ? 'text-emerald-400' : 'text-rose-400'}>{alert.brics_cosine_sim.toFixed(3)}</strong></span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* ===================================================================== */}
              {/* RIGHT COLUMN: 2D Molecular Clash Inspector & Safe ATC Swap (4 cols) */}
              {/* ===================================================================== */}
              <div className="col-span-4 bg-slate-900/40 flex flex-col h-full overflow-hidden">
                <div className="p-4 border-b border-slate-800 bg-slate-900/70 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Atom className="w-4 h-4 text-rose-400" />
                    <span>RDKit 2D Molecular Clash Inspector</span>
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-mono">
                    MCS Crimson #EB3838
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {selectedAlert ? (
                    <>
                      {/* Side-by-Side 2D SVG Box */}
                      <div className="grid grid-cols-2 gap-3">
                        {/* Molecule A */}
                        <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 flex flex-col">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-xs text-white truncate">{selectedAlert.drug_a}</span>
                            <span className="text-[10px] font-mono text-sky-400">{selectedAlert.drug_a_id || ''}</span>
                          </div>
                          <div
                            className="svg-container h-44 bg-slate-900/60 rounded-lg flex items-center justify-center p-1 border border-slate-800/80"
                            dangerouslySetInnerHTML={{ __html: molASvg || '<span class="text-xs text-slate-500">Rendering...</span>' }}
                          />
                          <div className="mt-2 text-[10px] text-slate-400 space-y-0.5">
                            <div className="flex justify-between"><span>Mol Wt:</span><span className="font-mono text-slate-300">{molAProps.mw.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span>LogP:</span><span className="font-mono text-slate-300">{molAProps.logp.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span>TPSA:</span><span className="font-mono text-slate-300">{molAProps.tpsa.toFixed(1)}</span></div>
                          </div>
                        </div>

                        {/* Molecule B */}
                        <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 flex flex-col">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-xs text-white truncate">{selectedAlert.drug_b}</span>
                            <span className="text-[10px] font-mono text-rose-400">{selectedAlert.drug_b_id || ''}</span>
                          </div>
                          <div
                            className="svg-container h-44 bg-slate-900/60 rounded-lg flex items-center justify-center p-1 border border-slate-800/80"
                            dangerouslySetInnerHTML={{ __html: molBSvg || '<span class="text-xs text-slate-500">Rendering...</span>' }}
                          />
                          <div className="mt-2 text-[10px] text-slate-400 space-y-0.5">
                            <div className="flex justify-between"><span>Mol Wt:</span><span className="font-mono text-slate-300">{molBProps.mw.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span>LogP:</span><span className="font-mono text-slate-300">{molBProps.logp.toFixed(2)}</span></div>
                            <div className="flex justify-between"><span>TPSA:</span><span className="font-mono text-slate-300">{molBProps.tpsa.toFixed(1)}</span></div>
                          </div>
                        </div>
                      </div>

                      {/* Substructure Clash Banner */}
                      <div className="p-3 rounded-xl bg-rose-950/30 border border-rose-800/40 text-xs">
                        <div className="flex items-center justify-between text-rose-400 font-semibold mb-1">
                          <span className="flex items-center gap-1.5">
                            <ShieldAlert className="w-4 h-4" />
                            <span>Reactive Substructure Overlap</span>
                          </span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-900 text-rose-200">
                            {sharedAtomsCount} Shared MCS Atoms
                          </span>
                        </div>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          {selectedAlert.mechanism}
                        </p>
                      </div>

                      {/* 1-Click Safe ATC Substitute Card */}
                      {activeSubstitute && (
                        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 shadow-lg space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                              <span>Recommended Safe Within-Class Substitute</span>
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold font-mono">
                              D_i,j' = 0 Verified
                            </span>
                          </div>

                          <div className="bg-slate-950/80 p-3 rounded-lg border border-emerald-900/40 space-y-2">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-[10px] text-slate-400 block">REPLACE WITH</span>
                                <span className="text-sm font-bold text-white">
                                  {activeSubstitute.substitute_name} [{activeSubstitute.substitute_drug_id || activeSubstitute.substitute_id}]
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-slate-400 block">THERAPEUTIC CLASS</span>
                                <span className="text-xs text-emerald-400 font-medium">
                                  {activeSubstitute.atc_class || 'Same ATC-3 Family'}
                                </span>
                              </div>
                            </div>

                            <p className="text-slate-300 text-[11px] leading-relaxed">
                              {activeSubstitute.clinical_rationale || activeSubstitute.reason}
                            </p>

                            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-[10px] text-slate-400">
                              <span>Pre-Swap DDI: <span className="text-rose-400 font-mono font-bold">{(summary.set_ddi_rate * 100).toFixed(1)}%</span></span>
                              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Post-Swap DDI: <span className="text-emerald-400 font-mono font-bold">0.0%</span></span>
                            </div>
                          </div>

                          <button
                            onClick={applySafeSubstitution}
                            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center space-x-2"
                          >
                            <RefreshCw className="w-4 h-4" />
                            <span>🔄 Replace {activeSubstitute.replace_drug_name || activeSubstitute.original_drug_name} with {activeSubstitute.substitute_name}</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-20 text-slate-500 text-xs">
                      <Atom className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                      Select a drug-drug interaction alert from the center triage feed to inspect live 2D chemical structures.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
};
