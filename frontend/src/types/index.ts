export interface PatientContext {
  patient_id: string;
  age: number;
  gender: string;
  department?: string;
  department_id?: string;
  primary_icd?: string;
  allergies?: string[];
  visits?: PatientVisit[];
}

export interface PatientVisit {
  visit_id: string;
  admission_type?: string;
  department_id?: string;
  icd10_diagnoses?: Array<{ code: string; title: string }>;
  icd_procedures?: Array<{ code: string; title: string }>;
  prescribed_meds?: string[];
  tolerated_meds?: string[];
}

export interface DemoCase {
  case_id: string;
  title: string;
  clinical_setting: string;
  patient_context: {
    patient_id: string;
    age: number;
    gender: string;
    diagnosis: string;
    history: string;
    allergies: string[];
  };
  draft_prescription: Array<{
    name: string;
    drug_id: string;
    dose: string;
  }>;
  active_severe_ddis: Array<{
    pair: [string, string];
    severity: string;
    adverse_effect: string;
    mechanism: string;
    mitigation_substitutes: string[];
  }>;
}

export interface FormularyDrug {
  drug_id: string;
  name: string;
  ndc_code?: string;
  rxcui: string;
  atc4_code?: string;
  atc3_code?: string;
  atc_class_name?: string;
  smiles?: string;
  molecular_weight?: number;
  logp?: number;
  hbd?: number;
  hba?: number;
  tpsa?: number;
  rotatable_bonds?: number;
  brics_fragments?: string[];
  brics_fragment_count?: number;
}

export interface AuditAlert {
  alert_id: string;
  drug_a: string;
  drug_b: string;
  drug_a_id?: string;
  drug_b_id?: string;
  twosides_effect: string;
  mechanism: string;
  severity: string;
  alert_tier: 'HARD_STOP_CRITICAL' | 'PASSIVE_INLINE_WARNING' | 'SUPPRESSED_SPAM';
  override_probability: number;
  acceptance_probability: number;
  epistemic_uncertainty: number;
  brics_cosine_sim: number;
  shared_substructures?: string[];
  svg_url?: string;
}

export interface SafeSubstitute {
  replace_drug_id: string;
  replace_drug_name: string;
  substitute_drug_id: string;
  substitute_name: string;
  atc_class?: string;
  new_set_ddi_rate?: number;
  reason?: string;
  pre_swap_ddi_rate?: number;
  post_swap_ddi_rate?: number;
  clinical_rationale?: string;
  original_drug_id?: string;
  original_drug_name?: string;
  substitute_id?: string;
  substitute_atc_class?: string;
}

export interface AuditSummary {
  total_drugs: number;
  total_pairs_checked: number;
  raw_rule_alerts_count: number;
  suppressed_spam_count: number;
  alert_fatigue_reduction_pct: number | string;
  passive_warnings_count: number;
  hard_stop_count: number;
  set_ddi_rate: number;
  safety_status: string;
}

export interface AuditResponse {
  summary: AuditSummary;
  alerts: AuditAlert[];
  safe_substitutes: SafeSubstitute[];
  status?: string;
  message?: string;
  execution_latency_ms?: number;
}

export interface MoleculeGraphDetails {
  drug_id: string;
  name: string;
  smiles: string;
  ontology_chain: {
    raw_ndc: string;
    rxcui: string;
    atc4_code: string;
    atc3_code: string;
    atc_class_name: string;
  };
  molecular_properties: {
    molecular_weight: number;
    logp: number;
    hbd: number;
    hba: number;
    tpsa: number;
    rotatable_bonds: number;
    formula?: string;
  };
  svg: string;
  brics_fragments: string[];
  brics_fragment_indices: number[];
  brics_fragment_count: number;
  twosides_ddi_edges: Array<{
    partner_id: string;
    partner_name: string;
    severity_tier: string;
    twosides_side_effect: string;
    mechanism: string;
    safe_substitutes: string[];
  }>;
  twosides_ddi_count: number;
  safe_class_alternatives: Array<{
    drug_id: string;
    name: string;
    atc4_code: string;
    atc3_code: string;
    atc_class_name: string;
    rxcui: string;
    clinical_rationale: string;
  }>;
}

export interface AlertFatigueModelMetric {
  model_name: string;
  Accuracy: number;
  Sensitivity: number;
  Specificity: number;
  PPV: number;
  NPV: number;
  F1: number;
  AUROC: number;
  Brier: number;
  roc_curve: {
    fpr: number[];
    tpr: number[];
  };
  uncertainty_gated?: boolean;
}

export interface LongitudinalEhrBaseline {
  model_name: string;
  DDI_Rate: number;
  Jaccard: number;
  F1: number;
  PRAUC: number;
  Avg_Meds: number;
  Params: string;
  Inference_Time_ms: number;
  architecture: string;
}

export interface ParetoPoint {
  gamma: number;
  DDI_Rate: number;
  Jaccard: number;
  F1: number;
  PRAUC: number;
  beta_mean: number;
  ddi_reduction_pct: number;
}

export interface BenchmarksResponse {
  title: string;
  description: string;
  dataset_metadata: {
    cpoe_records: number;
    physicians: number;
    hospital_departments: number;
    formulary_drugs: number;
    unique_brics_substructures: number;
    mask_H_shape: [number, number];
    twosides_ddi_pairs: number;
  };
  alert_fatigue_models: AlertFatigueModelMetric[];
  longitudinal_ehr_baselines: LongitudinalEhrBaseline[];
  pareto_tradeoff_curve: ParetoPoint[];
  bipartite_mask_ablation: {
    with_mask_H: {
      Cos_interacted: number;
      Cos_all: number;
      Output_DDI: number;
      condition_satisfied: boolean;
      interpretation: string;
    };
    without_mask_H: {
      Cos_interacted: number;
      Cos_all: number;
      Output_DDI: number;
      condition_satisfied: boolean;
      interpretation: string;
    };
    table_5_replication: string;
  };
}
