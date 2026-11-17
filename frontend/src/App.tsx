import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { Tab1CpoeFirewall } from './components/Tab1CpoeFirewall';
import { Tab2Cheminformatics } from './components/Tab2Cheminformatics';
import { Tab3Benchmarks } from './components/Tab3Benchmarks';
import { DemoCase, FormularyDrug, PatientContext } from './types';
import { fetchFormulary, fetchPatients } from './services/api';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cpoe' | 'brics' | 'benchmarks'>('cpoe');
  const [patients, setPatients] = useState<PatientContext[]>([]);
  const [demoCases, setDemoCases] = useState<DemoCase[]>([]);
  const [formulary, setFormulary] = useState<FormularyDrug[]>([]);
  const [currentPatient, setCurrentPatient] = useState<PatientContext | null>(null);
  const [draftMedications, setDraftMedications] = useState<FormularyDrug[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>('CASE-1');
  const [initialLoading, setInitialLoading] = useState(true);

  // Initialize Data
  useEffect(() => {
    Promise.all([fetchPatients(), fetchFormulary()])
      .then(([ptData, fData]) => {
        setPatients(ptData.patients || []);
        setDemoCases(ptData.demo_cases || []);
        setFormulary(fData);

        // Auto-load Case 1 on initial mount
        const case1 = ptData.demo_cases?.find((c) => c.case_id === 'CASE-1');
        if (case1) {
          applyCasePreset(case1, fData);
        }

        setInitialLoading(false);
      })
      .catch((err) => {
        console.error('Initialization error:', err);
        setInitialLoading(false);
      });
  }, []);

  const applyCasePreset = (caseData: DemoCase, currentFormulary: FormularyDrug[]) => {
    setActivePresetId(caseData.case_id);

    const ptCtx: any = caseData.patient_context || {};
    const patientObj: PatientContext = {
      patient_id: ptCtx.patient_id || caseData.case_id,
      age: ptCtx.age || 68,
      gender: ptCtx.gender || 'M',
      department: 'Cardiology (CICU)',
      department_id: 'ICU-CARD',
      primary_icd: ptCtx.diagnosis || 'Acute Coronary Syndrome',
      allergies: ptCtx.allergies || [],
      visits: [
        {
          visit_id: `${ptCtx.patient_id || 'PT'}-V1`,
          admission_type: 'EMERGENCY',
          icd10_diagnoses: [
            { code: 'I25.1', title: 'Atherosclerotic heart disease' },
            { code: 'K25.9', title: 'Gastric ulcer' },
          ],
          icd_procedures: [{ code: '00.66', title: 'PTCA coronary angioplasty' }],
          tolerated_meds: ['B01AC06', 'C10AA05', 'C07AB02'],
        },
        {
          visit_id: `${ptCtx.patient_id || 'PT'}-V2`,
          admission_type: 'URGENT',
          icd10_diagnoses: [{ code: 'I21.0', title: 'STEMI anterior wall' }],
          icd_procedures: [{ code: '36.06', title: 'Drug-eluting stent placement' }],
          tolerated_meds: ['B01AC04', 'C10AA05'],
        },
      ],
    };
    setCurrentPatient(patientObj);

    // Map draft medications
    const meds = (caseData.draft_prescription || []).map((p) => {
      const match = currentFormulary.find(
        (d) =>
          d.drug_id.toLowerCase() === p.drug_id.toLowerCase() ||
          d.name.toLowerCase() === p.name.toLowerCase()
      );
      if (match) return match;
      return {
        drug_id: p.drug_id,
        name: p.name,
        atc4_code: p.drug_id,
        rxcui: '12345',
        atc_class_name: 'ICU Medication',
      };
    });

    setDraftMedications(meds);
  };

  const handleSelectPreset = (caseId: string) => {
    const targetCase = demoCases.find((c) => c.case_id === caseId);
    if (targetCase) {
      applyCasePreset(targetCase, formulary);
      setActiveTab('cpoe');
    }
  };

  const handlePrescribeFromTab2 = (drugId: string) => {
    const drug = formulary.find((d) => d.drug_id === drugId);
    if (drug && !draftMedications.some((d) => d.drug_id === drug.drug_id)) {
      setDraftMedications((prev) => [...prev, drug]);
    }
    setActiveTab('cpoe');
  };

  const handleCompareInTab1 = (drugAId: string, drugBId: string) => {
    const drugA = formulary.find((d) => d.drug_id === drugAId);
    const drugB = formulary.find((d) => d.drug_id === drugBId);

    const pair = [drugA, drugB].filter(Boolean) as FormularyDrug[];
    setDraftMedications(pair);
    setActiveTab('cpoe');
  };

  if (initialLoading) {
    return (
      <div className="h-full bg-slate-950 flex items-center justify-center text-slate-400">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-2 border-sky-500 border-t-transparent rounded-full animate-spin"></div>
          <h1 className="text-base font-bold text-white tracking-tight">SafeAudit-CDSS</h1>
          <span className="text-xs font-mono text-slate-500">Connecting to AI Molecular Firewall & CPOE Engine...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col font-sans bg-slate-950 text-slate-100 overflow-hidden">
      <Header activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'cpoe' && (
          <Tab1CpoeFirewall
            patients={patients}
            demoCases={demoCases}
            formulary={formulary}
            currentPatient={currentPatient}
            setCurrentPatient={setCurrentPatient}
            draftMedications={draftMedications}
            setDraftMedications={setDraftMedications}
            activePresetId={activePresetId}
            onSelectPreset={handleSelectPreset}
          />
        )}

        {activeTab === 'brics' && (
          <Tab2Cheminformatics
            onPrescribe={handlePrescribeFromTab2}
            onCompareInTab1={handleCompareInTab1}
          />
        )}

        {activeTab === 'benchmarks' && <Tab3Benchmarks />}
      </main>
    </div>
  );
};
export default App;
