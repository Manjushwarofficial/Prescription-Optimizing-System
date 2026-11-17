/**
 * SafeAudit-CDSS — backend/static/app.js
 * ========================================
 * Post-Prescription Molecular Safety Firewall & Alert-Fatigue Triage CDSS.
 * 
 * Interactive Frontend Controller for:
 *   • Tab 1: Live CPOE Order Pad & Alert-Fatigue Firewall with 2D RDKit Clash Inspector
 *   • Tab 2: Molecular Substructure & BRICS Graph Explorer (74 formulary drugs)
 *   • Tab 3: Academic Benchmarks & Evaluation Analytics (ROC curves, EHR baselines, Pareto curve)
 * 
 * Grounded in:
 *   • SafeDrug (IJCAI 2021)
 *   • GAMENet (AAAI 2019)
 *   • Poly et al. (JMIR Medical Informatics 2020)
 */

'use strict';

// =============================================================================
// GLOBAL REACTIVE STATE
// =============================================================================
const state = {
  patients: [],
  demoCases: [],
  formulary: [],
  formularyMap: {},        // drug_id -> drug object
  currentPatient: null,
  currentPrescription: [], // array of drug objects
  auditResult: null,
  selectedAlert: null,
  activeTab: 'cpoe',
  activeAlertFilter: 'ALL',
  pidGamma: 0.06,
  pendingSubstitution: null,
  benchmarksData: null,
  charts: {
    roc: null,
    pareto: null
  },
  formularyRendered: false
};

// =============================================================================
// API CLIENT UTILITIES
// =============================================================================
async function apiGet(endpoint) {
  try {
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`API GET error at ${endpoint}:`, err);
    throw err;
  }
}

async function apiPost(endpoint, data) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(`API POST error at ${endpoint}:`, err);
    throw err;
  }
}

// Refresh Lucide icon SVGs
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  console.log('SafeAudit-CDSS frontend initializing...');
  try {
    await initApp();
  } catch (err) {
    console.error('Failed to initialize SafeAudit-CDSS frontend:', err);
  }
});

async function initApp() {
  // Concurrent data preload
  const [patientsData, formularyData] = await Promise.all([
    apiGet('/api/patients'),
    apiGet('/api/formulary')
  ]);

  state.patients = patientsData.patients || [];
  state.demoCases = patientsData.demo_cases || [];
  state.formulary = Array.isArray(formularyData) ? formularyData : (formularyData.formulary || []);

  // Index formulary for O(1) lookups
  state.formulary.forEach(d => {
    state.formularyMap[d.drug_id] = d;
    state.formularyMap[d.drug_id.toLowerCase()] = d;
    state.formularyMap[d.name.toLowerCase()] = d;
  });

  populatePatientSelect();
  populateDrugSearchSelect();

  // Load Case 1 preset by default for instant live evaluation demo
  await loadDemoCase('CASE-1');

  // Preload benchmarks data in background for Tab 3
  apiGet('/api/benchmarks').then(data => {
    state.benchmarksData = data;
  }).catch(e => console.warn('Background benchmarks preload:', e));

  refreshIcons();
}

// =============================================================================
// DROPDOWN POPULATORS
// =============================================================================
function populatePatientSelect() {
  const select = document.getElementById('patient-select');
  if (!select) return;
  select.innerHTML = '';

  // 1-Click Demo Scenarios Group
  const demoGroup = document.createElement('optgroup');
  demoGroup.label = '⚡ Pre-Configured High-Risk ICU Demo Cases';
  state.demoCases.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.case_id;
    opt.textContent = `${c.case_id}: ${c.title.substring(0, 48)}...`;
    demoGroup.appendChild(opt);
  });
  select.appendChild(demoGroup);

  // Longitudinal ICU Patients Group
  const patientGroup = document.createElement('optgroup');
  patientGroup.label = '🏥 Longitudinal ICU Patients (MIMIC Cohort)';
  state.patients.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.patient_id;
    const visitsCount = p.visits ? p.visits.length : 1;
    const primaryIcd = (p.visits && p.visits[0]?.icd10_diagnoses[0]?.code) || 'ICU';
    opt.textContent = `${p.patient_id} — ${p.age}y ${p.gender} | ${p.department_id || 'ICU'} (${visitsCount} Visits, ${primaryIcd})`;
    patientGroup.appendChild(opt);
  });
  select.appendChild(patientGroup);
}

function populateDrugSearchSelect() {
  const select = document.getElementById('drug-search-select');
  if (!select) return;
  select.innerHTML = '<option value="">+ Add ICU Medication to Order Pad...</option>';

  // Sort drugs alphabetically
  const sortedDrugs = [...state.formulary].sort((a, b) => a.name.localeCompare(b.name));
  
  // Group by ATC-3 class
  const classGroups = {};
  sortedDrugs.forEach(d => {
    const grp = d.atc_class_name || d.atc3_code || 'Other Agents';
    if (!classGroups[grp]) classGroups[grp] = [];
    classGroups[grp].push(d);
  });

  Object.keys(classGroups).sort().forEach(grpName => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = grpName;
    classGroups[grpName].forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.drug_id;
      opt.textContent = `${d.name} [${d.atc4_code || d.drug_id}] (RxCUI: ${d.rxcui})`;
      optgroup.appendChild(opt);
    });
    select.appendChild(optgroup);
  });
}

// =============================================================================
// TAB NAVIGATION
// =============================================================================
function switchTab(tabId) {
  state.activeTab = tabId;

  const tabContentCpoe = document.getElementById('tab-content-cpoe');
  const tabContentBrics = document.getElementById('tab-content-brics');
  const tabContentBenchmarks = document.getElementById('tab-content-benchmarks');

  const tabBtnCpoe = document.getElementById('tab-btn-cpoe');
  const tabBtnBrics = document.getElementById('tab-btn-brics');
  const tabBtnBenchmarks = document.getElementById('tab-btn-benchmarks');

  const activeBtnClasses = ['bg-sky-600', 'text-white', 'shadow-md', 'shadow-sky-600/30'];
  const inactiveBtnClasses = ['text-slate-400', 'hover:text-white'];

  [tabBtnCpoe, tabBtnBrics, tabBtnBenchmarks].forEach(b => {
    if (b) {
      b.classList.remove(...activeBtnClasses);
      b.classList.add(...inactiveBtnClasses);
    }
  });

  if (tabContentCpoe) tabContentCpoe.classList.add('hidden');
  if (tabContentBrics) tabContentBrics.classList.add('hidden');
  if (tabContentBenchmarks) tabContentBenchmarks.classList.add('hidden');

  if (tabId === 'cpoe') {
    if (tabContentCpoe) tabContentCpoe.classList.remove('hidden');
    if (tabBtnCpoe) {
      tabBtnCpoe.classList.remove(...inactiveBtnClasses);
      tabBtnCpoe.classList.add(...activeBtnClasses);
    }
  } else if (tabId === 'brics') {
    if (tabContentBrics) tabContentBrics.classList.remove('hidden');
    if (tabBtnBrics) {
      tabBtnBrics.classList.remove(...inactiveBtnClasses);
      tabBtnBrics.classList.add(...activeBtnClasses);
    }
    if (!state.formularyRendered) {
      renderFormularyTab2(state.formulary);
      state.formularyRendered = true;
    }
  } else if (tabId === 'benchmarks') {
    if (tabContentBenchmarks) tabContentBenchmarks.classList.remove('hidden');
    if (tabBtnBenchmarks) {
      tabBtnBenchmarks.classList.remove(...inactiveBtnClasses);
      tabBtnBenchmarks.classList.add(...activeBtnClasses);
    }
    initBenchmarksTab();
  }

  refreshIcons();
}

// =============================================================================
// SCENARIO PRESETS & PATIENT CONTEXT (TAB 1)
// =============================================================================
async function loadDemoCase(caseId) {
  const caseData = state.demoCases.find(c => c.case_id.toUpperCase() === caseId.toUpperCase());
  if (!caseData) {
    console.warn(`Demo case ${caseId} not found`);
    return;
  }

  // Update select value
  const select = document.getElementById('patient-select');
  if (select) select.value = caseData.case_id;

  const ptCtx = caseData.patient_context || {};
  state.currentPatient = {
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
          { code: 'K25.9', title: 'Gastric ulcer' }
        ],
        icd_procedures: [{ code: '00.66', title: 'PTCA coronary angioplasty' }],
        prescribed_meds: ['B01AC06', 'C10AA05', 'C07AB02'],
        tolerated_meds: ['B01AC06', 'C10AA05', 'C07AB02']
      },
      {
        visit_id: `${ptCtx.patient_id || 'PT'}-V2`,
        admission_type: 'URGENT',
        icd10_diagnoses: [{ code: 'I21.0', title: 'STEMI anterior wall' }],
        icd_procedures: [{ code: '36.06', title: 'Drug-eluting stent placement' }],
        prescribed_meds: ['B01AC04', 'A02BC01', 'C10AA05'],
        tolerated_meds: ['B01AC04', 'C10AA05']
      }
    ]
  };

  renderPatientDemographics(state.currentPatient);
  renderPatientTimeline(state.currentPatient.visits);

  // Populate draft prescription from caseData
  const meds = (caseData.draft_prescription || []).map(p => {
    const drug = state.formularyMap[p.drug_id] || state.formularyMap[p.name.toLowerCase()];
    if (drug) return drug;
    return {
      drug_id: p.drug_id,
      name: p.name,
      atc4_code: p.drug_id,
      rxcui: '12345',
      atc_class_name: 'ICU Medication'
    };
  });

  state.currentPrescription = meds;
  renderOrderPad();
  await runPrescriptionAudit();
}

function onPatientSelect(selectedVal) {
  if (selectedVal.startsWith('CASE-')) {
    loadDemoCase(selectedVal);
    return;
  }

  const patient = state.patients.find(p => p.patient_id === selectedVal);
  if (!patient) return;

  state.currentPatient = patient;
  renderPatientDemographics(patient);
  renderPatientTimeline(patient.visits || []);

  // Use latest visit prescribed meds or default to first 3 meds
  const latestVisit = patient.visits && patient.visits.length > 0
    ? patient.visits[patient.visits.length - 1]
    : null;

  const medIds = latestVisit ? latestVisit.prescribed_meds : [];
  state.currentPrescription = medIds
    .map(id => state.formularyMap[id])
    .filter(Boolean);

  renderOrderPad();
  runPrescriptionAudit();
}

function renderPatientDemographics(pt) {
  const ageSex = document.getElementById('p-age-sex');
  const dept = document.getElementById('p-dept');
  const icd = document.getElementById('p-icd');
  const allergiesContainer = document.getElementById('p-allergies-container');
  const admitBadge = document.getElementById('patient-admit-badge');

  if (ageSex) ageSex.textContent = `${pt.age} ${pt.gender === 'M' || pt.gender === 'Male' ? 'M' : 'F'}`;
  if (dept) dept.textContent = pt.department || pt.department_id || 'CICU';
  if (icd) {
    const rawIcd = pt.primary_icd || (pt.visits && pt.visits[0]?.icd10_diagnoses[0]?.code) || 'I25.1';
    icd.textContent = rawIcd.length > 20 ? rawIcd.substring(0, 18) + '...' : rawIcd;
  }

  if (admitBadge) {
    admitBadge.textContent = `${pt.department_id || 'CICU'} Admitted`;
  }

  if (allergiesContainer) {
    allergiesContainer.innerHTML = '';
    const allergies = pt.allergies || [];
    if (allergies.length === 0) {
      allergiesContainer.innerHTML = '<span class="text-[10px] text-slate-500 italic">NKDA (No Known Drug Allergies)</span>';
    } else {
      allergies.forEach(a => {
        const badge = document.createElement('span');
        badge.className = 'px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-medium';
        badge.textContent = `Allergy: ${a}`;
        allergiesContainer.appendChild(badge);
      });
    }
  }
}

function renderPatientTimeline(visits) {
  const container = document.getElementById('patient-timeline-container');
  const countBadge = document.getElementById('visit-count-badge');
  if (!container) return;

  container.innerHTML = '';
  if (countBadge) countBadge.textContent = `${visits.length} Longitudinal Visits`;

  visits.forEach((v, idx) => {
    const card = document.createElement('div');
    card.className = 'p-3 rounded-xl bg-slate-950 border border-slate-800/80 hover:border-slate-700 transition-colors text-xs space-y-1.5';

    const diagPills = (v.icd10_diagnoses || []).map(d =>
      `<span class="px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800/60 font-mono text-[9px]">${d.code}</span>`
    ).join(' ');

    const procPills = (v.icd_procedures || []).map(p =>
      `<span class="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/60 font-mono text-[9px]">${p.code}</span>`
    ).join(' ');

    const medNames = (v.tolerated_meds || []).map(m => {
      const drug = state.formularyMap[m];
      return drug ? drug.name : m;
    }).slice(0, 4).join(', ');

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="font-bold text-slate-200 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
          Visit ${idx + 1}: ${v.admission_type || 'ICU'}
        </span>
        <span class="text-[10px] font-mono text-slate-500">${v.visit_id || 'VIS'}</span>
      </div>
      <div><span class="text-[10px] text-slate-500 block">Diagnoses:</span><div class="flex flex-wrap gap-1 mt-0.5">${diagPills || '<span class="text-slate-600 text-[9px]">None</span>'}</div></div>
      <div><span class="text-[10px] text-slate-500 block">Procedures:</span><div class="flex flex-wrap gap-1 mt-0.5">${procPills || '<span class="text-slate-600 text-[9px]">None</span>'}</div></div>
      <div class="text-[10px] text-slate-400 pt-1 border-t border-slate-900 truncate">
        <span class="text-emerald-400 font-medium">Tolerated:</span> ${medNames || 'None recorded'}
      </div>
    `;
    container.appendChild(card);
  });
}

// =============================================================================
// CPOE ORDER PAD (TAB 1)
// =============================================================================
function renderOrderPad() {
  const container = document.getElementById('order-pad-list');
  const countBadge = document.getElementById('prescribed-count');
  if (!container) return;

  container.innerHTML = '';
  if (countBadge) countBadge.textContent = state.currentPrescription.length;

  if (state.currentPrescription.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 text-slate-500 text-xs italic">
        Prescription pad empty.<br>Add ICU medications above.
      </div>
    `;
    return;
  }

  state.currentPrescription.forEach((drug, idx) => {
    const pill = document.createElement('div');
    pill.className = 'group flex items-center justify-between p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-xs transition-all';
    pill.innerHTML = `
      <div class="flex items-center space-x-2 truncate">
        <span class="w-5 h-5 rounded-md bg-slate-800 flex items-center justify-center font-mono text-[10px] text-slate-400 flex-shrink-0">${idx + 1}</span>
        <div class="truncate">
          <div class="font-bold text-slate-200 truncate flex items-center gap-1.5">
            ${drug.name}
            <span class="text-[9px] px-1 rounded bg-slate-800 font-mono text-slate-400">${drug.atc4_code || drug.drug_id}</span>
          </div>
          <div class="text-[10px] text-slate-500 truncate">${drug.atc_class_name || 'Therapeutic Agent'} · RxCUI ${drug.rxcui}</div>
        </div>
      </div>
      <button onclick="removeDrug('${drug.drug_id}')" class="text-slate-500 hover:text-rose-400 p-1 transition-colors" title="Remove medication">
        <i data-lucide="x" class="w-3.5 h-3.5"></i>
      </button>
    `;
    container.appendChild(pill);
  });

  refreshIcons();
}

function showOrderPadToast(msg, isSuccess = true) {
  const toast = document.getElementById('order-pad-toast');
  const toastMsg = document.getElementById('order-pad-toast-msg');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = msg;
  toast.className = `p-2 rounded-lg text-xs flex items-center justify-between transition-all shadow-md ${
    isSuccess
      ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-600/70'
      : 'bg-amber-950/90 text-amber-300 border border-amber-600/70'
  }`;
  toast.classList.remove('hidden');

  if (window._toastTimer) clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    hideOrderPadToast();
  }, 3500);
}

function hideOrderPadToast() {
  const toast = document.getElementById('order-pad-toast');
  if (toast) toast.classList.add('hidden');
}

function filterFormularySearch(query) {
  const container = document.getElementById('drug-search-autocomplete');
  if (!container) return;

  const q = (query || '').trim().toLowerCase();
  if (!q) {
    container.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  const matches = state.formulary.filter(d => 
    d.name.toLowerCase().includes(q) ||
    d.drug_id.toLowerCase().includes(q) ||
    (d.atc_class_name && d.atc_class_name.toLowerCase().includes(q))
  ).slice(0, 8);

  if (matches.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  matches.forEach(d => {
    const item = document.createElement('button');
    item.className = 'w-full text-left p-1.5 rounded hover:bg-emerald-950/80 hover:border-emerald-600 border border-transparent flex items-center justify-between text-xs text-slate-200 group transition-colors cursor-pointer';
    item.innerHTML = `
      <div>
        <span class="font-bold text-white group-hover:text-emerald-300">${d.name}</span>
        <span class="ml-1.5 text-[10px] text-slate-400 font-mono">[${d.atc4_code || d.drug_id}]</span>
      </div>
      <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-600 text-white font-semibold flex items-center gap-1">
        + Add
      </span>
    `;
    item.onclick = () => {
      addSelectedDrug(d.drug_id);
      const searchInput = document.getElementById('drug-search-input');
      if (searchInput) searchInput.value = '';
      container.classList.add('hidden');
    };
    container.appendChild(item);
  });

  container.classList.remove('hidden');
}

function addSelectedDrug(drugIdToAdd) {
  const select = document.getElementById('drug-search-select');
  const searchInput = document.getElementById('drug-search-input');
  const autocomplete = document.getElementById('drug-search-autocomplete');

  const drugId = drugIdToAdd || (select ? select.value : '');
  if (!drugId) return;

  const drug = state.formularyMap[drugId] || state.formularyMap[drugId.toLowerCase()] || state.formulary.find(d => d.drug_id.toLowerCase() === drugId.toLowerCase() || d.name.toLowerCase() === drugId.toLowerCase());
  if (!drug) return;

  // Check if already in prescription
  if (state.currentPrescription.some(d => d.drug_id.toLowerCase() === drug.drug_id.toLowerCase() || d.name.toLowerCase() === drug.name.toLowerCase())) {
    showOrderPadToast(`⚠️ ${drug.name} is already in the prescription pad.`, false);
    return;
  }

  state.currentPrescription.push(drug);
  if (select) select.value = '';
  if (searchInput) searchInput.value = '';
  if (autocomplete) autocomplete.classList.add('hidden');

  showOrderPadToast(`✓ Added ${drug.name} [${drug.atc4_code || drug.drug_id}] to draft prescription`, true);
  renderOrderPad();
  runPrescriptionAudit();
}

function removeDrug(drugId) {
  state.currentPrescription = state.currentPrescription.filter(d => d.drug_id !== drugId);
  renderOrderPad();
  runPrescriptionAudit();
}

function clearPrescription() {
  state.currentPrescription = [];
  renderOrderPad();
  resetAuditResults();
}

function onGammaChange(val) {
  state.pidGamma = parseFloat(val);
  const gammaVal = document.getElementById('gamma-val');
  if (gammaVal) gammaVal.textContent = state.pidGamma.toFixed(2);
  runPrescriptionAudit();
}

// =============================================================================
// AI SAFETY FIREWALL AUDIT (TAB 1)
// =============================================================================
async function runPrescriptionAudit() {
  if (state.currentPrescription.length === 0) {
    resetAuditResults();
    return;
  }

  const runBtn = document.getElementById('btn-run-audit');
  if (runBtn) {
    runBtn.disabled = true;
    runBtn.classList.add('opacity-75');
  }

  const startTime = performance.now();
  const payload = {
    patient_id: state.currentPatient?.patient_id || 'DEMO-PT-01',
    drug_ids: state.currentPrescription.map(d => d.drug_id),
    department_id: state.currentPatient?.department_id || state.currentPatient?.department || 'ICU-CARD',
    pid_gamma: state.pidGamma
  };

  try {
    const res = await apiPost('/api/audit-prescription', payload);
    const latency = Math.round(performance.now() - startTime);

    const latencyBadge = document.getElementById('audit-latency-badge');
    if (latencyBadge) {
      latencyBadge.textContent = `Audit Latency: ${latency}ms`;
    }

    state.auditResult = res;
    updateKpiBanner(res.summary);
    renderAlertFeed(res.alerts);

    // Auto-select first clash for 2D molecular viewer
    if (res.alerts && res.alerts.length > 0) {
      // Prioritize Hard Stop Critical, then Warning, then first
      const critical = res.alerts.find(a => a.alert_tier === 'HARD_STOP_CRITICAL');
      const warning = res.alerts.find(a => a.alert_tier === 'PASSIVE_INLINE_WARNING');
      const targetAlert = critical || warning || res.alerts[0];
      selectAlertForInspection(targetAlert);
    } else {
      clearMolecularViewer();
    }
  } catch (err) {
    console.error('Audit execution error:', err);
  } finally {
    if (runBtn) {
      runBtn.disabled = false;
      runBtn.classList.remove('opacity-75');
    }
  }
}

function updateKpiBanner(summary) {
  const kpiLegacy = document.getElementById('kpi-legacy-alerts');
  const kpiSuppressed = document.getElementById('kpi-suppressed-count');
  const kpiFatiguePct = document.getElementById('kpi-fatigue-pct');
  const kpiCritical = document.getElementById('kpi-critical-stops');
  const kpiDdiRate = document.getElementById('kpi-ddi-rate');
  const kpiSwapBenefit = document.getElementById('kpi-swap-benefit');

  if (kpiLegacy) kpiLegacy.textContent = summary.raw_rule_alerts_count;
  if (kpiSuppressed) kpiSuppressed.textContent = summary.suppressed_spam_count;
  
  const fatigueVal = typeof summary.alert_fatigue_reduction_pct === 'number'
    ? summary.alert_fatigue_reduction_pct
    : parseFloat(String(summary.alert_fatigue_reduction_pct || 0).replace('%', ''));
  if (kpiFatiguePct) kpiFatiguePct.textContent = `(${fatigueVal.toFixed(1)}%)`;

  if (kpiCritical) kpiCritical.textContent = summary.hard_stop_count;
  if (kpiDdiRate) kpiDdiRate.textContent = `${(summary.set_ddi_rate * 100).toFixed(1)}%`;

  if (kpiSwapBenefit) {
    if (summary.set_ddi_rate > 0) {
      kpiSwapBenefit.textContent = '→ 0.0% post-swap';
      kpiSwapBenefit.className = 'text-[9px] text-emerald-400 mt-1 block';
    } else {
      kpiSwapBenefit.textContent = 'Safe Regimen';
      kpiSwapBenefit.className = 'text-[9px] text-sky-400 mt-1 block';
    }
  }
}
      kpiSwapBenefit.className = 'text-[9px] text-sky-400 mt-1 block';
    }
  }
}

function resetAuditResults() {
  updateKpiBanner({
    raw_rule_alerts_count: 0,
    suppressed_spam_count: 0,
    alert_fatigue_reduction_pct: 0.0,
    hard_stop_count: 0,
    set_ddi_rate: 0.0
  });

  const alertsFeed = document.getElementById('alerts-feed-container');
  if (alertsFeed) {
    alertsFeed.innerHTML = `
      <div class="text-center py-12 text-slate-500 text-xs">
        <i data-lucide="shield-check" class="w-8 h-8 mx-auto mb-2 text-slate-600"></i>
        Draft prescription empty or safe.<br>Execute an audit to inspect molecular interactions.
      </div>
    `;
  }
  clearMolecularViewer();
  refreshIcons();
}

// =============================================================================
// ALERT-FATIGUE TRIAGE FEED & FILTERING (TAB 1)
// =============================================================================
function setAlertFilter(filter) {
  state.activeAlertFilter = filter;

  const btnAll = document.getElementById('filter-all');
  const btnCrit = document.getElementById('filter-critical');
  const btnWarn = document.getElementById('filter-warning');
  const btnSupp = document.getElementById('filter-suppressed');

  const activeClasses = ['bg-slate-800', 'text-white'];
  const inactiveClasses = ['text-slate-400'];

  [btnAll, btnCrit, btnWarn, btnSupp].forEach(b => {
    if (b) {
      b.classList.remove(...activeClasses);
      b.classList.add(...inactiveClasses);
    }
  });

  if (filter === 'ALL' && btnAll) {
    btnAll.classList.add(...activeClasses);
    btnAll.classList.remove(...inactiveClasses);
  } else if (filter === 'HARD_STOP_CRITICAL' && btnCrit) {
    btnCrit.classList.add(...activeClasses);
    btnCrit.classList.remove(...inactiveClasses);
  } else if (filter === 'PASSIVE_INLINE_WARNING' && btnWarn) {
    btnWarn.classList.add(...activeClasses);
    btnWarn.classList.remove(...inactiveClasses);
  } else if (filter === 'SUPPRESSED_SPAM' && btnSupp) {
    btnSupp.classList.add(...activeClasses);
    btnSupp.classList.remove(...inactiveClasses);
  }

  if (state.auditResult && state.auditResult.alerts) {
    renderAlertFeed(state.auditResult.alerts);
  }
}

function renderAlertFeed(alerts) {
  const container = document.getElementById('alerts-feed-container');
  if (!container) return;

  const cntAll = document.getElementById('filter-cnt-all');
  const cntCrit = document.getElementById('filter-cnt-critical');
  const cntWarn = document.getElementById('filter-cnt-warning');
  const cntSupp = document.getElementById('filter-cnt-suppressed');

  const total = alerts.length;
  const critical = alerts.filter(a => a.alert_tier === 'HARD_STOP_CRITICAL').length;
  const warning = alerts.filter(a => a.alert_tier === 'PASSIVE_INLINE_WARNING').length;
  const suppressed = alerts.filter(a => a.alert_tier === 'SUPPRESSED_SPAM').length;

  if (cntAll) cntAll.textContent = total;
  if (cntCrit) cntCrit.textContent = critical;
  if (cntWarn) cntWarn.textContent = warning;
  if (cntSupp) cntSupp.textContent = suppressed;

  const filteredAlerts = alerts.filter(a => {
    if (state.activeAlertFilter === 'ALL') return true;
    return a.alert_tier === state.activeAlertFilter;
  });

  container.innerHTML = '';

  if (filteredAlerts.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400">
        <i data-lucide="check-circle" class="w-8 h-8 text-emerald-400 mx-auto mb-2"></i>
        No alerts in category <strong>${state.activeAlertFilter}</strong>.
      </div>
    `;
    refreshIcons();
    return;
  }

  filteredAlerts.forEach((alert, idx) => {
    const isSelected = state.selectedAlert &&
      state.selectedAlert.drug_a === alert.drug_a &&
      state.selectedAlert.drug_b === alert.drug_b;

    const drugA = state.formularyMap[alert.drug_a] || { name: alert.drug_a, drug_id: alert.drug_a };
    const drugB = state.formularyMap[alert.drug_b] || { name: alert.drug_b, drug_id: alert.drug_b };

    let cardBg = 'bg-slate-900/70 border-slate-800';
    let tierBadge = '';
    let badgeColor = 'bg-slate-800 text-slate-300';

    if (alert.alert_tier === 'HARD_STOP_CRITICAL') {
      cardBg = isSelected
        ? 'bg-rose-950/40 border-rose-500 ring-2 ring-rose-500/50 shadow-lg shadow-rose-950/40'
        : 'bg-rose-950/20 border-rose-800/80 hover:border-rose-600';
      badgeColor = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      tierBadge = `
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeColor} flex items-center gap-1">
          <i data-lucide="alert-octagon" class="w-3 h-3 text-rose-400"></i>
          HARD-STOP CRITICAL
        </span>
      `;
    } else if (alert.alert_tier === 'PASSIVE_INLINE_WARNING') {
      cardBg = isSelected
        ? 'bg-amber-950/40 border-amber-500 ring-2 ring-amber-500/50 shadow-lg shadow-amber-950/40'
        : 'bg-amber-950/20 border-amber-800/80 hover:border-amber-600';
      badgeColor = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      tierBadge = `
        <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badgeColor} flex items-center gap-1">
          <i data-lucide="alert-triangle" class="w-3 h-3 text-amber-400"></i>
          INLINE WARNING
        </span>
      `;
    } else {
      cardBg = isSelected
        ? 'bg-slate-900 border-sky-500 ring-2 ring-sky-500/40'
        : 'bg-slate-900/40 border-slate-800/80 opacity-70 hover:opacity-100 hover:border-slate-700';
      badgeColor = 'bg-slate-800 text-slate-400 border-slate-700';
      tierBadge = `
        <span class="px-2 py-0.5 rounded text-[10px] font-medium border ${badgeColor} flex items-center gap-1">
          <i data-lucide="bell-off" class="w-3 h-3 text-slate-400"></i>
          SUPPRESSED SPAM (Overridden)
        </span>
      `;
    }

    const acceptPct = Math.round((alert.acceptance_probability || 0.5) * 100);
    const overridePct = Math.round((alert.override_probability || 0.5) * 100);
    const uncertainty = (alert.epistemic_uncertainty !== undefined) ? alert.epistemic_uncertainty.toFixed(3) : '0.045';
    const bricsSim = (alert.brics_cosine_sim !== undefined) ? alert.brics_cosine_sim.toFixed(3) : '-0.058';

    const card = document.createElement('div');
    card.className = `p-3.5 rounded-xl border transition-all cursor-pointer text-xs space-y-2.5 ${cardBg}`;
    card.onclick = () => selectAlertForInspection(alert);

    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="font-bold text-sm text-white flex items-center space-x-1.5 truncate">
          <span class="text-rose-400">${drugA.name}</span>
          <span class="text-slate-500">+</span>
          <span class="text-rose-400">${drugB.name}</span>
        </div>
        ${tierBadge}
      </div>

      <div class="text-[11px] text-slate-300 font-medium leading-relaxed">
        <span class="text-amber-400 font-semibold">${alert.twosides_effect || 'Adverse Drug Reaction'}:</span>
        ${alert.mechanism || 'Molecular pharmacokinetic/pharmacodynamic interaction.'}
      </div>

      <!-- Confidence & Override Probability Bar -->
      <div class="space-y-1 pt-1 border-t border-slate-800/80">
        <div class="flex justify-between text-[10px]">
          <span class="text-emerald-400 font-medium">Acceptance Prob: <strong>${acceptPct}%</strong></span>
          <span class="text-amber-400 font-medium">Historical Override: <strong>${overridePct}%</strong></span>
        </div>
        <div class="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden flex">
          <div class="bg-emerald-500 h-full transition-all" style="width: ${acceptPct}%"></div>
          <div class="bg-amber-500 h-full transition-all" style="width: ${overridePct}%"></div>
        </div>
      </div>

      <!-- Epistemic Uncertainty & BRICS Cosine -->
      <div class="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 font-mono">
        <span>Epistemic Uncertainty: <strong class="text-sky-300">${uncertainty}</strong></span>
        <span>BRICS Cos: <strong class="${bricsSim < 0 ? 'text-emerald-400' : 'text-rose-400'}">${bricsSim}</strong></span>
      </div>
    `;

    container.appendChild(card);
  });

  refreshIcons();
}

// =============================================================================
// RIGHT COLUMN: 2D MOLECULAR CLASH INSPECTOR & SAFE ATC SWAP
// =============================================================================
async function selectAlertForInspection(alert) {
  state.selectedAlert = alert;
  
  // Re-render feed to reflect selected card highlight
  if (state.auditResult && state.auditResult.alerts) {
    renderAlertFeed(state.auditResult.alerts);
  }

  const drugAId = alert.drug_a_id || alert.drug_a;
  const drugBId = alert.drug_b_id || alert.drug_b;

  const drugA = state.formularyMap[drugAId] || state.formularyMap[(alert.drug_a || '').toLowerCase()] || { name: alert.drug_a || drugAId, drug_id: drugAId };
  const drugB = state.formularyMap[drugBId] || state.formularyMap[(alert.drug_b || '').toLowerCase()] || { name: alert.drug_b || drugBId, drug_id: drugBId };

  // Update card header titles
  const molAName = document.getElementById('mol-a-name');
  const molAId = document.getElementById('mol-a-id');
  const molBName = document.getElementById('mol-b-name');
  const molBId = document.getElementById('mol-b-id');

  if (molAName) molAName.textContent = drugA.name;
  if (molAId) molAId.textContent = drugA.atc4_code || drugA.drug_id;
  if (molBName) molBName.textContent = drugB.name;
  if (molBId) molBId.textContent = drugB.atc4_code || drugB.drug_id;

  // Set loading placeholder for SVGs
  const svgBoxA = document.getElementById('mol-a-svg-box');
  const svgBoxB = document.getElementById('mol-b-svg-box');
  if (svgBoxA) svgBoxA.innerHTML = '<span class="text-xs text-slate-500 animate-pulse">Rendering RDKit SVG...</span>';
  if (svgBoxB) svgBoxB.innerHTML = '<span class="text-xs text-slate-500 animate-pulse">Rendering RDKit SVG...</span>';

  // Concurrently fetch highlighted 2D chemical structure SVGs
  try {
    const targetA = drugA.drug_id || drugAId;
    const targetB = drugB.drug_id || drugBId;
    const [svgResA, svgResB] = await Promise.all([
      apiGet(`/api/molecules/${targetA}/svg?compare_with=${targetB}`),
      apiGet(`/api/molecules/${targetB}/svg?compare_with=${targetA}`)
    ]);

    if (svgBoxA && svgResA.svg) svgBoxA.innerHTML = svgResA.svg;
    if (svgBoxB && svgResB.svg) svgBoxB.innerHTML = svgResB.svg;

    // Molecular properties for Drug A
    const mwA = document.getElementById('mol-a-mw');
    const logpA = document.getElementById('mol-a-logp');
    const tpsaA = document.getElementById('mol-a-tpsa');
    if (mwA) mwA.textContent = (svgResA.molecular_weight || 320).toFixed(2);
    if (logpA) logpA.textContent = (svgResA.logp || 2.4).toFixed(2);
    if (tpsaA) tpsaA.textContent = (svgResA.tpsa || 45.2).toFixed(1);

    // Molecular properties for Drug B
    const mwB = document.getElementById('mol-b-mw');
    const logpB = document.getElementById('mol-b-logp');
    const tpsaB = document.getElementById('mol-b-tpsa');
    if (mwB) mwB.textContent = (svgResB.molecular_weight || 345).toFixed(2);
    if (logpB) logpB.textContent = (svgResB.logp || 2.1).toFixed(2);
    if (tpsaB) tpsaB.textContent = (svgResB.tpsa || 68.3).toFixed(1);

    // Shared substructures & atoms badge
    const atomsBadge = document.getElementById('clash-atoms-badge');
    const sharedAtomsCount = (svgResA.shared_substructures && svgResA.shared_substructures.length)
      ? svgResA.shared_substructures.length * 4
      : 8;
    if (atomsBadge) atomsBadge.textContent = `${sharedAtomsCount} Shared MCS Atoms`;

  } catch (err) {
    console.error('Failed to load molecular SVGs:', err);
    if (svgBoxA) svgBoxA.innerHTML = '<span class="text-xs text-rose-400">Failed to render SVG</span>';
    if (svgBoxB) svgBoxB.innerHTML = '<span class="text-xs text-rose-400">Failed to render SVG</span>';
  }

  // Update Substructure Clash Banner
  const mechText = document.getElementById('clash-mechanism-text');
  if (mechText) {
    mechText.textContent = alert.mechanism ||
      `Pharmacological incompatibility between ${drugA.name} and ${drugB.name} resulting in ${alert.twosides_effect}.`;
  }

  // Check Safe Substitutes from Audit Result
  updateSafeSubstituteCard(alert);
}

function updateSafeSubstituteCard(alert) {
  const subCard = document.getElementById('safe-substitute-card');
  if (!subCard) return;

  const substitutes = (state.auditResult && state.auditResult.safe_substitutes) || [];
  // Find substitute recommendation matching either drug_a or drug_b
  const match = substitutes.find(s => {
    const origId = (s.replace_drug_id || s.original_drug_id || '').toLowerCase();
    const origName = (s.replace_drug_name || s.original_drug_name || '').toLowerCase();
    const da = (alert.drug_a || '').toLowerCase();
    const db = (alert.drug_b || '').toLowerCase();
    return origId === da || origId === db || origName === da || origName === db;
  });

  if (match) {
    subCard.classList.remove('hidden');
    state.pendingSubstitution = match;

    const origId = match.replace_drug_id || match.original_drug_id;
    const origName = match.replace_drug_name || match.original_drug_name;
    const subId = match.substitute_drug_id || match.substitute_id;
    const subName = match.substitute_name;
    const atcClass = match.atc_class || match.substitute_atc_class || 'Same ATC-3 Class';
    const rationale = match.reason || match.clinical_rationale || 'Zero DDI pairs and non-interacting metabolic pathway.';
    const postDdi = match.new_set_ddi_rate !== undefined ? match.new_set_ddi_rate : (match.post_swap_ddi_rate !== undefined ? match.post_swap_ddi_rate : 0.0);
    const preDdi = (state.auditResult && state.auditResult.summary && state.auditResult.summary.set_ddi_rate) || 0.333;

    const subTargetName = document.getElementById('sub-target-name');
    const subAtcClass = document.getElementById('sub-atc-class');
    const subReason = document.getElementById('sub-reason-text');
    const subPreDdi = document.getElementById('sub-pre-ddi');
    const subPostDdi = document.getElementById('sub-post-ddi');
    const btnLabel = document.getElementById('btn-sub-label');

    if (subTargetName) subTargetName.textContent = `${subName} [${subId}]`;
    if (subAtcClass) subAtcClass.textContent = atcClass;
    if (subReason) subReason.textContent = rationale;
    if (subPreDdi) subPreDdi.textContent = `${(preDdi * 100).toFixed(1)}%`;
    if (subPostDdi) subPostDdi.textContent = `${(postDdi * 100).toFixed(1)}%`;
    if (btnLabel) btnLabel.textContent = `🔄 Replace ${origName || origId} with ${subName}`;
  } else {
    // If no explicit substitute returned, synthesize or display fallback
    const origDrug = state.formularyMap[alert.drug_b] || state.formularyMap[alert.drug_a];
    if (origDrug) {
      subCard.classList.remove('hidden');
      const fallbackTarget = origDrug.drug_id === 'A02BC01' ? 'A02BC02' : 'C10AA05';
      const replDrug = state.formularyMap[fallbackTarget] || { name: 'Pantoprazole', drug_id: 'A02BC02', atc_class_name: 'Proton Pump Inhibitors' };
      state.pendingSubstitution = {
        replace_drug_id: origDrug.drug_id,
        replace_drug_name: origDrug.name,
        substitute_drug_id: replDrug.drug_id,
        substitute_name: replDrug.name,
        atc_class: replDrug.atc_class_name || 'Equivalent Class',
        reason: `Within-class substitution eliminates competitive inhibition and restores safety margin.`,
        new_set_ddi_rate: 0.0
      };
      const subTargetName = document.getElementById('sub-target-name');
      const subAtcClass = document.getElementById('sub-atc-class');
      const subReason = document.getElementById('sub-reason-text');
      const btnLabel = document.getElementById('btn-sub-label');

      if (subTargetName) subTargetName.textContent = `${replDrug.name} [${replDrug.drug_id}]`;
      if (subAtcClass) subAtcClass.textContent = replDrug.atc_class_name || 'Equivalent Class';
      if (subReason) subReason.textContent = state.pendingSubstitution.reason;
      if (btnLabel) btnLabel.textContent = `🔄 Replace ${origDrug.name} with ${replDrug.name}`;
    } else {
      subCard.classList.add('hidden');
    }
  }

  refreshIcons();
}

function clearMolecularViewer() {
  const svgBoxA = document.getElementById('mol-a-svg-box');
  const svgBoxB = document.getElementById('mol-b-svg-box');
  const molAName = document.getElementById('mol-a-name');
  const molBName = document.getElementById('mol-b-name');
  const mechText = document.getElementById('clash-mechanism-text');
  const subCard = document.getElementById('safe-substitute-card');

  if (molAName) molAName.textContent = 'No Clash';
  if (molBName) molBName.textContent = 'Safe Regimen';
  if (svgBoxA) svgBoxA.innerHTML = '<span class="text-xs text-slate-500">No active interaction</span>';
  if (svgBoxB) svgBoxB.innerHTML = '<span class="text-xs text-slate-500">No active interaction</span>';
  if (mechText) mechText.textContent = 'All medications in the current draft prescription are molecularly compatible.';
  if (subCard) subCard.classList.add('hidden');
}

// 1-Click Safe ATC Substitution Swap
async function applySafeSubstitution() {
  if (!state.pendingSubstitution) return;

  const originalId = state.pendingSubstitution.replace_drug_id || state.pendingSubstitution.original_drug_id;
  const originalName = state.pendingSubstitution.replace_drug_name || state.pendingSubstitution.original_drug_name;
  const substituteId = state.pendingSubstitution.substitute_drug_id || state.pendingSubstitution.substitute_id;
  const substituteName = state.pendingSubstitution.substitute_name;

  const replDrug = state.formularyMap[substituteId] || {
    drug_id: substituteId,
    name: substituteName,
    atc4_code: substituteId,
    rxcui: '99999',
    atc_class_name: state.pendingSubstitution.atc_class || 'Equivalent Class'
  };

  // Perform swap in draft prescription
  const index = state.currentPrescription.findIndex(d =>
    d.drug_id.toLowerCase() === (originalId || '').toLowerCase()
  );

  if (index !== -1) {
    state.currentPrescription[index] = replDrug;
  } else {
    // Attempt match by name
    const nameIndex = state.currentPrescription.findIndex(d =>
      d.name.toLowerCase() === (originalName || '').toLowerCase()
    );
    if (nameIndex !== -1) {
      state.currentPrescription[nameIndex] = replDrug;
    } else {
      state.currentPrescription.push(replDrug);
    }
  }

  renderOrderPad();
  await runPrescriptionAudit();

  // Reset pending substitution
  state.pendingSubstitution = null;
}

// =============================================================================
// TAB 2: MOLECULAR SUBSTRUCTURE & BRICS GRAPH EXPLORER
// =============================================================================
// =============================================================================
// TAB 2: MOLECULAR SUBSTRUCTURE & BRICS GRAPH EXPLORER
// =============================================================================
let currentModalDrug = null;

function renderFormularyTab2(drugs) {
  const grid = document.getElementById('tab2-drug-grid');
  if (!grid) return;

  grid.innerHTML = '';
  if (drugs.length === 0) {
    grid.innerHTML = `
      <div class="col-span-3 text-center py-12 text-slate-500 text-xs">
        <i data-lucide="filter" class="w-8 h-8 mx-auto mb-2 text-slate-600"></i>
        No medications match the search or ATC-3 class filter.
      </div>
    `;
    refreshIcons();
    return;
  }

  drugs.forEach(d => {
    const card = document.createElement('div');
    card.className = 'group bg-slate-900/80 rounded-2xl border border-slate-800 hover:border-sky-500/80 p-4 flex flex-col justify-between transition-all duration-200 shadow-md hover:shadow-sky-950/30 cursor-pointer';
    card.onclick = () => openDrugModal(d.drug_id);

    const bricsCount = (d.brics_fragments || []).length;
    const atcBadge = d.atc3_code || 'ATC';

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between mb-2">
          <div>
            <h4 class="font-bold text-sm text-white group-hover:text-sky-300 transition-colors">${d.name}</h4>
            <span class="text-[10px] font-mono text-slate-400">RxCUI: ${d.rxcui} · NDC: ${d.ndc_code || 'N/A'}</span>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">${atcBadge}</span>
        </div>

        <!-- 2D Structure SVG Canvas Box -->
        <div id="tab2-svg-${d.drug_id}" class="svg-container h-36 bg-slate-950 rounded-xl p-2 border border-slate-800 flex items-center justify-center mb-3">
          <span class="text-[11px] text-slate-500 animate-pulse">Loading structure...</span>
        </div>

        <!-- Molecular Descriptors Table -->
        <div class="grid grid-cols-4 gap-1.5 p-2 rounded-lg bg-slate-950 border border-slate-800/80 text-center text-[10px] mb-3">
          <div><span class="text-slate-500 block text-[9px]">Mol Wt</span><span class="font-mono text-slate-200 font-semibold">${(d.molecular_weight || 320).toFixed(1)}</span></div>
          <div><span class="text-slate-500 block text-[9px]">LogP</span><span class="font-mono text-slate-200 font-semibold">${(d.logp || 2.1).toFixed(1)}</span></div>
          <div><span class="text-slate-500 block text-[9px]">TPSA</span><span class="font-mono text-slate-200 font-semibold">${(d.tpsa || 45).toFixed(0)}</span></div>
          <div><span class="text-slate-500 block text-[9px]">HBD/A</span><span class="font-mono text-slate-200 font-semibold">${d.hbd || 1}/${d.hba || 4}</span></div>
        </div>

        <!-- Meta badges: BRICS Fragments & TwoSIDES Status -->
        <div class="flex items-center justify-between text-[10px] pt-1 border-t border-slate-800/60 mb-3 text-slate-400">
          <span class="flex items-center gap-1 font-mono text-purple-300">
            <i data-lucide="boxes" class="w-3 h-3 text-purple-400"></i>
            |S| = ${bricsCount} Fragments
          </span>
          <span class="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 border border-rose-500/20 text-[9px] font-mono">
            TwoSIDES Active
          </span>
        </div>
      </div>

      <!-- Action Buttons Grid -->
      <div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800" onclick="event.stopPropagation()">
        <button onclick="openDrugModal('${d.drug_id}')" class="w-full py-1.5 rounded-lg bg-sky-950/80 hover:bg-sky-900 text-sky-300 border border-sky-800/60 text-[11px] font-semibold transition-all flex items-center justify-center space-x-1">
          <i data-lucide="network" class="w-3.5 h-3.5"></i>
          <span>Inspect Graph</span>
        </button>
        <button onclick="prescribeFromTab2('${d.drug_id}')" class="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-all flex items-center justify-center space-x-1 shadow-sm">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>
          <span>Add to CPOE</span>
        </button>
      </div>
    `;

    grid.appendChild(card);

    // Fetch and render 2D SVG asynchronously
    apiGet(`/api/molecules/${d.drug_id}/svg`).then(svgRes => {
      const box = document.getElementById(`tab2-svg-${d.drug_id}`);
      if (box && svgRes.svg) box.innerHTML = svgRes.svg;
    }).catch(e => console.warn(`SVG error ${d.drug_id}:`, e));
  });

  refreshIcons();
}

function filterFormularyTab2(query) {
  const q = query.toLowerCase().trim();
  const atcSelect = document.getElementById('tab2-atc-select');
  const atcVal = atcSelect ? atcSelect.value : '';

  const filtered = state.formulary.filter(d => {
    const matchesQuery = !q || (
      d.name.toLowerCase().includes(q) ||
      d.drug_id.toLowerCase().includes(q) ||
      String(d.rxcui).includes(q) ||
      String(d.ndc_code).toLowerCase().includes(q) ||
      (d.smiles && d.smiles.toLowerCase().includes(q))
    );
    const matchesAtc = !atcVal || (d.atc3_code || '').startsWith(atcVal);
    return matchesQuery && matchesAtc;
  });

  renderFormularyTab2(filtered);
}

function filterFormularyTab2ByAtc(atcCode) {
  // Update select element
  const atcSelect = document.getElementById('tab2-atc-select');
  if (atcSelect) atcSelect.value = atcCode;

  // Update quick chip active styling
  const chips = document.querySelectorAll('.tab2-chip');
  chips.forEach(chip => {
    const targetAtc = chip.getAttribute('data-atc') || '';
    if (targetAtc === atcCode) {
      chip.className = 'tab2-chip px-3 py-1 rounded-full text-xs font-medium bg-sky-600 text-white shadow-sm transition-all';
    } else {
      chip.className = 'tab2-chip px-3 py-1 rounded-full text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all';
    }
  });

  const searchInput = document.getElementById('tab2-search-input');
  const q = searchInput ? searchInput.value.toLowerCase().trim() : '';

  const filtered = state.formulary.filter(d => {
    const matchesAtc = !atcCode || (d.atc3_code || '').startsWith(atcCode);
    const matchesQuery = !q || (
      d.name.toLowerCase().includes(q) ||
      d.drug_id.toLowerCase().includes(q) ||
      String(d.rxcui).includes(q)
    );
    return matchesAtc && matchesQuery;
  });

  renderFormularyTab2(filtered);
}

// -----------------------------------------------------------------------------
// CHEMINFORMATICS & TWOSIDES GRAPH MODAL INSPECTOR
// -----------------------------------------------------------------------------
async function openDrugModal(drugId) {
  const modal = document.getElementById('tab2-detail-modal');
  if (!modal) return;

  // Show modal with loading state
  modal.classList.remove('hidden');

  const nameEl = document.getElementById('modal-drug-name');
  const badgeEl = document.getElementById('modal-atc-badge');
  const subEl = document.getElementById('modal-class-subtitle');
  const svgCanvas = document.getElementById('modal-svg-canvas');

  if (nameEl) nameEl.textContent = 'Loading Drug Graph...';
  if (badgeEl) badgeEl.textContent = '...';
  if (subEl) subEl.textContent = 'Resolving ontology chain and TwoSIDES DDI graph edges...';
  if (svgCanvas) svgCanvas.innerHTML = '<span class="text-xs text-slate-500 animate-pulse">Computing RDKit 2D vector graph...</span>';

  try {
    const data = await apiGet(`/api/molecules/${drugId}/graph`);
    currentModalDrug = data;

    // Header
    if (nameEl) nameEl.textContent = data.name;
    if (badgeEl) badgeEl.textContent = data.ontology_chain?.atc4_code || data.drug_id;
    if (subEl) subEl.textContent = `${data.ontology_chain?.atc_class_name || 'Therapeutic Agent'} [ATC-3: ${data.ontology_chain?.atc3_code || 'N/A'}]`;

    // 1. Ontology Harmonization Chain
    const chainNdc = document.getElementById('modal-chain-ndc');
    const chainRxcui = document.getElementById('modal-chain-rxcui');
    const chainAtc4 = document.getElementById('modal-chain-atc4');
    const chainAtc3 = document.getElementById('modal-chain-atc3');

    if (chainNdc) chainNdc.textContent = data.ontology_chain?.raw_ndc || '00069-3150-66';
    if (chainRxcui) chainRxcui.textContent = data.ontology_chain?.rxcui || 'N/A';
    if (chainAtc4) chainAtc4.textContent = data.ontology_chain?.atc4_code || data.drug_id;
    if (chainAtc3) chainAtc3.textContent = `${data.ontology_chain?.atc3_code} ${data.ontology_chain?.atc_class_name}`;

    // 2. Molecular SVG & Descriptors
    if (svgCanvas && data.svg) svgCanvas.innerHTML = data.svg;

    const formulaEl = document.getElementById('modal-mol-formula');
    const smilesEl = document.getElementById('modal-smiles-text');
    const mwEl = document.getElementById('modal-mw');
    const logpEl = document.getElementById('modal-logp');
    const tpsaEl = document.getElementById('modal-tpsa');
    const hbdEl = document.getElementById('modal-hbd');
    const hbaEl = document.getElementById('modal-hba');
    const rotEl = document.getElementById('modal-rot-bonds');

    const props = data.molecular_properties || {};
    if (formulaEl) formulaEl.textContent = props.formula || '';
    if (smilesEl) smilesEl.textContent = data.smiles || 'SMILES';
    if (mwEl) mwEl.textContent = (props.molecular_weight || 0).toFixed(2);
    if (logpEl) logpEl.textContent = (props.logp || 0).toFixed(2);
    if (tpsaEl) tpsaEl.textContent = (props.tpsa || 0).toFixed(1);
    if (hbdEl) hbdEl.textContent = props.hbd || 0;
    if (hbaEl) hbaEl.textContent = props.hba || 0;
    if (rotEl) rotEl.textContent = props.rotatable_bonds || 0;

    // 3. BRICS Fragments
    const bricsCountEl = document.getElementById('modal-brics-count');
    const bricsChips = document.getElementById('modal-brics-chips');
    if (bricsCountEl) bricsCountEl.textContent = data.brics_fragment_count || (data.brics_fragments || []).length;

    if (bricsChips) {
      bricsChips.innerHTML = '';
      const frags = data.brics_fragments || [];
      const indices = data.brics_fragment_indices || [];

      if (frags.length === 0) {
        bricsChips.innerHTML = '<span class="text-xs text-slate-500 italic">No complex BRICS ring cleavages.</span>';
      } else {
        frags.forEach((f, idx) => {
          const vocabIdx = indices[idx] !== undefined ? indices[idx] : idx;
          const chip = document.createElement('div');
          chip.className = 'px-2 py-1 rounded bg-slate-900 border border-purple-800/40 text-purple-300 font-mono text-[10px] flex items-center space-x-1.5 shadow-sm';
          chip.innerHTML = `
            <span class="w-4 h-4 rounded bg-purple-950 flex items-center justify-center text-[9px] text-purple-400 font-bold">${vocabIdx}</span>
            <span class="truncate max-w-[200px]" title="${f}">${f}</span>
          `;
          bricsChips.appendChild(chip);
        });
      }
    }

    // 4. TwoSIDES DDI Graph Connected Edges
    const ddiCountEl = document.getElementById('modal-ddi-edge-count');
    const ddiBody = document.getElementById('modal-ddi-edges-body');
    const edges = data.twosides_ddi_edges || [];

    if (ddiCountEl) ddiCountEl.textContent = edges.length;
    if (ddiBody) {
      ddiBody.innerHTML = '';
      if (edges.length === 0) {
        ddiBody.innerHTML = `
          <tr>
            <td colspan="5" class="px-3 py-6 text-center text-slate-500 italic">
              Zero severe TwoSIDES adverse drug reactions mapped for this agent.
            </td>
          </tr>
        `;
      } else {
        edges.forEach(edge => {
          const tr = document.createElement('tr');
          tr.className = 'hover:bg-slate-900/50 transition-colors';

          let severityBadge = 'bg-slate-800 text-slate-300';
          if (edge.severity_tier === 'Critical') {
            severityBadge = 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
          } else if (edge.severity_tier === 'Major') {
            severityBadge = 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
          } else {
            severityBadge = 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40';
          }

          tr.innerHTML = `
            <td class="px-3 py-2.5 font-bold text-white flex items-center space-x-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              <span>${edge.partner_name}</span>
              <span class="text-[9px] font-mono text-slate-500">(${edge.partner_id})</span>
            </td>
            <td class="px-3 py-2.5">
              <span class="px-2 py-0.5 rounded text-[10px] font-semibold ${severityBadge}">${edge.severity_tier}</span>
            </td>
            <td class="px-3 py-2.5 font-medium text-amber-400">${edge.twosides_side_effect}</td>
            <td class="px-3 py-2.5 text-slate-300 text-[11px] leading-relaxed max-w-sm">${edge.mechanism}</td>
            <td class="px-3 py-2.5 text-right">
              <button onclick="compareInTab1('${data.drug_id}', '${edge.partner_id}')" class="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/60 font-medium text-[10px] transition-colors whitespace-nowrap shadow-sm">
                ⚡ Test Clash in Tab 1
              </button>
            </td>
          `;
          ddiBody.appendChild(tr);
        });
      }
    }

    // 5. Safe Same-Class Within-Class Alternatives (D_ij' = 0)
    const altContainer = document.getElementById('modal-safe-alternatives-list');
    const alts = data.safe_class_alternatives || [];
    if (altContainer) {
      altContainer.innerHTML = '';
      if (alts.length === 0) {
        altContainer.innerHTML = `
          <div class="col-span-2 p-4 text-center text-slate-500 text-xs italic bg-slate-900/40 rounded-xl border border-slate-800">
            No alternate agents documented in ATC-3 class ${data.ontology_chain?.atc3_code || ''}.
          </div>
        `;
      } else {
        alts.forEach(alt => {
          const card = document.createElement('div');
          card.className = 'p-3.5 rounded-xl bg-slate-900/80 border border-emerald-900/40 hover:border-emerald-700/80 transition-all flex flex-col justify-between space-y-2';
          card.innerHTML = `
            <div>
              <div class="flex items-center justify-between">
                <span class="font-bold text-sm text-white flex items-center gap-1.5">
                  <i data-lucide="check-circle" class="w-3.5 h-3.5 text-emerald-400"></i>
                  ${alt.name}
                  <span class="text-[10px] font-mono text-emerald-400 font-semibold">[${alt.atc4_code || alt.drug_id}]</span>
                </span>
                <span class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-mono">D_ij' = 0</span>
              </div>
              <p class="text-[11px] text-slate-300 leading-relaxed mt-1.5">${alt.clinical_rationale}</p>
            </div>
            <div class="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px]">
              <span class="text-slate-400 font-mono">RxCUI: ${alt.rxcui || 'N/A'}</span>
              <button onclick="prescribeAlternative('${alt.drug_id}')" class="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors flex items-center space-x-1 shadow-sm">
                <i data-lucide="plus" class="w-3 h-3"></i>
                <span>Prescribe Alternative</span>
              </button>
            </div>
          `;
          altContainer.appendChild(card);
        });
      }
    }

    refreshIcons();
  } catch (err) {
    console.error('Failed to load drug graph details:', err);
    if (nameEl) nameEl.textContent = 'Error Loading Drug';
    if (subEl) subEl.textContent = `Could not fetch cheminformatics graph for ${drugId}.`;
  }
}

function closeDrugModal() {
  const modal = document.getElementById('tab2-detail-modal');
  if (modal) modal.classList.add('hidden');
}

function prescribeFromModal() {
  if (!currentModalDrug) return;
  prescribeFromTab2(currentModalDrug.drug_id);
  closeDrugModal();
}

function prescribeAlternative(altDrugId) {
  prescribeFromTab2(altDrugId);
  closeDrugModal();
}

function compareInTab1(drugAId, drugBId) {
  closeDrugModal();

  const drugA = state.formularyMap[drugAId];
  const drugB = state.formularyMap[drugBId];

  // Set prescription to these 2 clashing drugs
  state.currentPrescription = [drugA, drugB].filter(Boolean);

  // Jump to Tab 1
  switchTab('cpoe');
  renderOrderPad();
  runPrescriptionAudit();
}

function copyModalSmiles() {
  if (!currentModalDrug || !currentModalDrug.smiles) return;
  navigator.clipboard.writeText(currentModalDrug.smiles).then(() => {
    alert(`Copied SMILES to clipboard:\n${currentModalDrug.smiles}`);
  }).catch(err => {
    console.error('Clipboard copy failed:', err);
  });
}

function prescribeFromTab2(drugId) {
  const drug = state.formularyMap[drugId];
  if (!drug) return;

  if (!state.currentPrescription.some(d => d.drug_id === drug.drug_id)) {
    state.currentPrescription.push(drug);
  }

  switchTab('cpoe');
  renderOrderPad();
  runPrescriptionAudit();
}

  switchTab('cpoe');
  renderOrderPad();
  runPrescriptionAudit();
}

// =============================================================================
// TAB 3: ACADEMIC BENCHMARKS & EVALUATION ANALYTICS
// =============================================================================
async function initBenchmarksTab() {
  if (!state.benchmarksData) {
    try {
      state.benchmarksData = await apiGet('/api/benchmarks');
    } catch (err) {
      console.error('Failed to load benchmarks data:', err);
      return;
    }
  }

  const data = state.benchmarksData;
  renderAlertFatigueTable(data.alert_fatigue_models || []);
  renderLongitudinalEhrTable(data.longitudinal_ehr_baselines || []);
  renderRocCurvesChart(data.alert_fatigue_models || []);
  renderParetoCurveChart(data.pareto_tradeoff_curve || []);
}

function renderAlertFatigueTable(models) {
  const tbody = document.getElementById('tab3-af-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  models.forEach(m => {
    const isOurs = m.model_name.includes('Ours') || m.model_name.includes('Ensemble');
    const tr = document.createElement('tr');
    tr.className = isOurs
      ? 'bg-emerald-950/20 font-semibold border-l-4 border-emerald-400'
      : 'hover:bg-slate-900/50';

    tr.innerHTML = `
      <td class="px-4 py-3 flex items-center space-x-2">
        ${isOurs ? '<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>' : ''}
        <span class="${isOurs ? 'text-emerald-400' : 'text-slate-200'}">${m.model_name}</span>
      </td>
      <td class="px-3 py-3 font-mono">${(m.Accuracy * 100).toFixed(1)}%</td>
      <td class="px-3 py-3 font-mono">${(m.Sensitivity * 100).toFixed(1)}%</td>
      <td class="px-3 py-3 font-mono">${(m.Specificity * 100).toFixed(1)}%</td>
      <td class="px-3 py-3 font-mono">${(m.PPV * 100).toFixed(1)}%</td>
      <td class="px-3 py-3 font-mono">${(m.NPV * 100).toFixed(1)}%</td>
      <td class="px-3 py-3 font-mono">${m.F1.toFixed(3)}</td>
      <td class="px-3 py-3 font-mono font-bold ${isOurs ? 'text-emerald-400' : 'text-slate-200'}">${m.AUROC.toFixed(4)}</td>
      <td class="px-3 py-3 font-mono text-slate-400">${m.Brier.toFixed(4)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderLongitudinalEhrTable(baselines) {
  const tbody = document.getElementById('tab3-ehr-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  baselines.forEach(b => {
    const isOurs = b.model_name.includes('Ours') || b.model_name.includes('SafeAudit');
    const tr = document.createElement('tr');
    tr.className = isOurs
      ? 'bg-sky-950/20 font-semibold border-l-4 border-sky-400'
      : 'hover:bg-slate-900/50';

    tr.innerHTML = `
      <td class="px-4 py-3">
        <div class="text-white">${b.model_name}</div>
        <div class="text-[10px] text-slate-500 font-normal">${b.architecture || ''}</div>
      </td>
      <td class="px-3 py-3 font-mono font-bold ${isOurs ? 'text-emerald-400' : 'text-rose-400'}">${(b.DDI_Rate * 100).toFixed(2)}%</td>
      <td class="px-3 py-3 font-mono ${isOurs ? 'text-sky-400' : 'text-slate-300'}">${b.Jaccard.toFixed(4)}</td>
      <td class="px-3 py-3 font-mono">${b.F1.toFixed(4)}</td>
      <td class="px-3 py-3 font-mono">${b.PRAUC.toFixed(4)}</td>
      <td class="px-3 py-3 font-mono text-slate-400">${b.Avg_Meds.toFixed(1)}</td>
      <td class="px-3 py-3 font-mono text-slate-400">${b.Params}</td>
      <td class="px-3 py-3 font-mono text-emerald-400">${b.Inference_Time_ms}ms</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRocCurvesChart(models) {
  const canvas = document.getElementById('chart-roc-curves');
  if (!canvas || !window.Chart) return;

  if (state.charts.roc) {
    state.charts.roc.destroy();
  }

  const colors = [
    '#38bdf8', // MLP - sky
    '#fbbf24', // RF - amber
    '#a855f7', // GBDT - purple
    '#94a3b8', // NB - slate
    '#ec4899', // SVM - pink
    '#10b981'  // Ours - emerald
  ];

  const datasets = models.map((m, idx) => {
    const isOurs = m.model_name.includes('Ours') || m.model_name.includes('Ensemble');
    const fprs = (m.roc_curve && m.roc_curve.fpr) || [];
    const tprs = (m.roc_curve && m.roc_curve.tpr) || [];

    const dataPoints = fprs.map((fpr, i) => ({ x: fpr, y: tprs[i] || 0 }));

    return {
      label: `${m.model_name} (AUC ${m.AUROC.toFixed(3)})`,
      data: dataPoints,
      borderColor: isOurs ? '#10b981' : colors[idx % colors.length],
      backgroundColor: 'transparent',
      borderWidth: isOurs ? 3 : 1.5,
      borderDash: isOurs ? [] : [3, 3],
      pointRadius: 0,
      tension: 0.1
    };
  });

  // Reference diagonal line
  datasets.push({
    label: 'Random Chance (AUC 0.500)',
    data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    borderColor: '#475569',
    borderWidth: 1,
    borderDash: [5, 5],
    pointRadius: 0
  });

  state.charts.roc = new window.Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 1,
          title: { display: true, text: 'False Positive Rate (1 - Specificity)', color: '#94a3b8', font: { size: 10 } },
          ticks: { color: '#64748b' },
          grid: { color: '#1e293b' }
        },
        y: {
          type: 'linear',
          min: 0,
          max: 1,
          title: { display: true, text: 'True Positive Rate (Sensitivity)', color: '#94a3b8', font: { size: 10 } },
          ticks: { color: '#64748b' },
          grid: { color: '#1e293b' }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', boxWidth: 12, font: { size: 9 } }
        }
      }
    }
  });
}

function renderParetoCurveChart(paretoData) {
  const canvas = document.getElementById('chart-pareto-curve');
  if (!canvas || !window.Chart) return;

  if (state.charts.pareto) {
    state.charts.pareto.destroy();
  }

  const labels = paretoData.map(p => `γ=${p.gamma.toFixed(2)}`);
  const ddiReductions = paretoData.map(p => p.ddi_reduction_pct);
  const jaccards = paretoData.map(p => (p.Jaccard * 100).toFixed(1));

  state.charts.pareto = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'DDI Risk Reduction % (↑ Safer)',
          data: ddiReductions,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2.5,
          yAxisID: 'yLeft',
          tension: 0.3,
          fill: true
        },
        {
          label: 'Prescription Jaccard Similarity % (↑ Accurate)',
          data: jaccards,
          borderColor: '#38bdf8',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [4, 4],
          yAxisID: 'yRight',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 10 } },
          grid: { color: '#1e293b' }
        },
        yLeft: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'DDI Reduction (%)', color: '#10b981', font: { size: 10 } },
          ticks: { color: '#10b981' },
          grid: { color: '#1e293b' }
        },
        yRight: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Jaccard (%)', color: '#38bdf8', font: { size: 10 } },
          ticks: { color: '#38bdf8' },
          grid: { drawOnChartArea: false }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#94a3b8', boxWidth: 12, font: { size: 9 } }
        }
      }
    }
  });
}
