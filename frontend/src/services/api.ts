import {
  AuditResponse,
  BenchmarksResponse,
  DemoCase,
  FormularyDrug,
  MoleculeGraphDetails,
  PatientContext
} from '../types';

export const API_BASE = '';

export async function fetchPatients(): Promise<{
  patients: PatientContext[];
  demo_cases: DemoCase[];
  total_patients: number;
  total_demo_cases: number;
}> {
  const res = await fetch(`${API_BASE}/api/patients`);
  if (!res.ok) throw new Error(`Failed to fetch patients: ${res.statusText}`);
  return res.json();
}

export async function fetchFormulary(): Promise<FormularyDrug[]> {
  const res = await fetch(`${API_BASE}/api/formulary`);
  if (!res.ok) throw new Error(`Failed to fetch formulary: ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.formulary || [];
}

export async function auditPrescription(payload: {
  patient_id: string;
  drug_ids: string[];
  department_id: string;
  pid_gamma: number;
}): Promise<AuditResponse> {
  const res = await fetch(`${API_BASE}/api/audit-prescription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Audit request failed: ${res.statusText}`);
  return res.json();
}

export async function fetchMoleculeSvg(
  drugId: string,
  compareWith?: string
): Promise<{
  drug_id: string;
  svg: string;
  molecular_weight: number;
  logp: number;
  tpsa: number;
  brics_fragments: string[];
  shared_substructures?: string[];
}> {
  const query = compareWith ? `?compare_with=${encodeURIComponent(compareWith)}` : '';
  const res = await fetch(`${API_BASE}/api/molecules/${encodeURIComponent(drugId)}/svg${query}`);
  if (!res.ok) throw new Error(`Failed to fetch molecule SVG: ${res.statusText}`);
  return res.json();
}

export async function fetchMoleculeGraph(drugId: string): Promise<MoleculeGraphDetails> {
  const res = await fetch(`${API_BASE}/api/molecules/${encodeURIComponent(drugId)}/graph`);
  if (!res.ok) throw new Error(`Failed to fetch molecule graph: ${res.statusText}`);
  return res.json();
}

export async function fetchBenchmarks(): Promise<BenchmarksResponse> {
  const res = await fetch(`${API_BASE}/api/benchmarks`);
  if (!res.ok) throw new Error(`Failed to fetch benchmarks: ${res.statusText}`);
  return res.json();
}
