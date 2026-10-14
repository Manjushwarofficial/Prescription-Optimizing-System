"use client";

import { useState, useRef } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface InterventionEvent {
  drug_a: string;
  drug_b: string;
  severity: string;
  side_effect: string;
  mechanism: string;
  frequency: number;
  source: string;
  action_taken: string;
  pid_iteration: number;
  pid_error: number;
  pid_output: number;
}

interface OptimizationResponse {
  safe_prescription: Record<string, number>;
  system_interventions: InterventionEvent[];
  all_proposals: Record<string, number>;
  ddi_rate_before: number;
  ddi_rate_after: number;
  model_status: string;
  eval_metrics: Record<string, number>;
  alert_fatigue_note: string;
  fda_disclaimer: string;
  processing_time_ms: number;
}

// ─── Symptom presets for quick selection ────────────────────────────────────

const SYMPTOM_PRESETS = [
  {
    label: "Hypertension + Heart Failure",
    icon: "🫀",
    symptoms: ["hypertension", "heart_failure", "edema"],
  },
  {
    label: "Musculoskeletal Pain",
    icon: "🦴",
    symptoms: ["pain", "inflammation"],
  },
  {
    label: "GERD + Peptic Ulcer",
    icon: "🧬",
    symptoms: ["acid_reflux", "peptic_ulcer"],
  },
  {
    label: "Type 2 Diabetes",
    icon: "💉",
    symptoms: ["type2_diabetes", "hyperlipidemia"],
  },
  {
    label: "Stable Angina",
    icon: "❤️‍🩹",
    symptoms: ["angina", "hypertension", "hyperlipidemia"],
  },
  {
    label: "Bacterial Pneumonia",
    icon: "🫁",
    symptoms: ["bacterial_infection", "pneumonia", "fever"],
  },
];

const ALL_SYMPTOMS = [
  "hypertension", "heart_failure", "edema", "pain", "inflammation",
  "fever", "acid_reflux", "peptic_ulcer", "type2_diabetes", "hyperlipidemia",
  "angina", "bacterial_infection", "pneumonia", "renal_impairment",
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 85 ? "#22c55e" : pct >= 70 ? "#3b82f6" : "#f59e0b";
  return (
    <div className="confidence-pill" style={{ "--bar-color": color, "--bar-width": `${pct}%` } as React.CSSProperties}>
      <span className="confidence-text">{pct}%</span>
      <div className="confidence-bar-track">
        <div className="confidence-bar-fill" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, subtitle, color }: {
  label: string; value: string | number; subtitle?: string; color: string;
}) {
  return (
    <div className="metric-card" style={{ borderColor: color }}>
      <div className="metric-value" style={{ color }}>{value}</div>
      <div className="metric-label">{label}</div>
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ClinicalDashboard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([
    "hypertension", "heart_failure", "edema",
  ]);
  const [threshold, setThreshold] = useState(0.70);
  const resultsRef = useRef<HTMLDivElement>(null);

  const toggleSymptom = (sym: string) => {
    setSelectedSymptoms((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const applyPreset = (symptoms: string[]) => {
    setSelectedSymptoms(symptoms);
  };

  const generatePrescription = async () => {
    if (selectedSymptoms.length === 0) {
      setError("Please select at least one symptom.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("http://127.0.0.1:8000/api/optimize_prescription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symptoms: selectedSymptoms,
          confidence_threshold: threshold,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail ?? `Server error ${res.status}`);
      }

      const data: OptimizationResponse = await res.json();
      setResult(data);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-root">
      {/* ─── Background gradient blobs ─── */}
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />

      <div className="content-wrapper">

        {/* ─── HEADER ─────────────────────────────────────────────── */}
        <header className="header-card">
          <div className="header-left">
            <div className="header-badge">
              <span className="badge-dot" />
              CLINICAL DECISION SUPPORT
            </div>
            <h1 className="header-title">
              AI Prescription<br />
              <span className="title-accent">Optimization System</span>
            </h1>
            <p className="header-sub">
              Ensemble ML · TwoSIDES DDI Graph · PID Safety Controller ·
              SafeDrug Paradigm
            </p>
          </div>
          <div className="header-right">
            <div className="tech-pill">MLP + Random Forest</div>
            <div className="tech-pill">NetworkX KG</div>
            <div className="tech-pill">HDN-DDI Inspired</div>
          </div>
        </header>

        {/* ─── FDA DISCLAIMER ─────────────────────────────────────── */}
        <div className="fda-banner">
          <span className="fda-icon">⚕️</span>
          <span>
            <strong>FDA CDS Guidance (Jan 2026):</strong> This is an
            investigational decision-support tool. Not an autonomous
            prescribing system. Physician review required.
          </span>
        </div>

        {/* ─── SYMPTOM INPUT ──────────────────────────────────────── */}
        <section className="card input-card">
          <h2 className="section-title">
            <span className="section-icon">🩺</span>Patient Symptom Profile
          </h2>

          {/* Presets */}
          <div className="presets-row">
            {SYMPTOM_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`preset-btn ${
                  JSON.stringify([...p.symptoms].sort()) ===
                  JSON.stringify([...selectedSymptoms].sort())
                    ? "preset-btn-active"
                    : ""
                }`}
                onClick={() => applyPreset(p.symptoms)}
              >
                {p.icon} {p.label}
              </button>
            ))}
          </div>

          {/* Symptom toggles */}
          <div className="symptom-grid">
            {ALL_SYMPTOMS.map((sym) => (
              <button
                key={sym}
                className={`symptom-toggle ${selectedSymptoms.includes(sym) ? "sym-active" : ""}`}
                onClick={() => toggleSymptom(sym)}
              >
                {selectedSymptoms.includes(sym) ? "✓ " : ""}
                {sym.replace(/_/g, " ")}
              </button>
            ))}
          </div>

          {/* Threshold slider */}
          <div className="threshold-row">
            <label className="threshold-label">
              Confidence Threshold:
              <span className="threshold-value">{(threshold * 100).toFixed(0)}%</span>
            </label>
            <input
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="threshold-slider"
            />
          </div>

          {/* Active symptoms display */}
          {selectedSymptoms.length > 0 && (
            <div className="active-symptoms">
              {selectedSymptoms.map((s) => (
                <span key={s} className="active-tag">
                  {s.replace(/_/g, " ")}
                  <button className="tag-remove" onClick={() => toggleSymptom(s)}>×</button>
                </span>
              ))}
            </div>
          )}

          <button
            id="generate-btn"
            onClick={generatePrescription}
            disabled={loading || selectedSymptoms.length === 0}
            className="generate-btn"
          >
            {loading ? (
              <span className="btn-loading">
                <svg className="spin" viewBox="0 0 24 24" width="20" height="20">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="30 70" />
                </svg>
                Analysing Patient Profile...
              </span>
            ) : (
              "⚡ Generate Safe Prescription"
            )}
          </button>
        </section>

        {/* ─── ERROR ─────────────────────────────────────────────── */}
        {error && (
          <div className="error-banner">
            <span>⚠️ {error}</span>
          </div>
        )}

        {/* ─── RESULTS ───────────────────────────────────────────── */}
        {result && (
          <div ref={resultsRef} className="results-section">

            {/* ── Metrics bar ── */}
            <div className="metrics-bar">
              <MetricCard
                label="Jaccard Similarity"
                value={result.eval_metrics.jaccard ? `${(result.eval_metrics.jaccard * 100).toFixed(1)}%` : "N/A"}
                subtitle="Drug set accuracy"
                color="#6366f1"
              />
              <MetricCard
                label="PRAUC"
                value={result.eval_metrics.prauc ? `${(result.eval_metrics.prauc * 100).toFixed(1)}%` : "N/A"}
                subtitle="Precision-recall AUC"
                color="#8b5cf6"
              />
              <MetricCard
                label="DDI Rate Before"
                value={`${(result.ddi_rate_before * 100).toFixed(1)}%`}
                subtitle="Pre-resolution"
                color="#f59e0b"
              />
              <MetricCard
                label="DDI Rate After"
                value={`${(result.ddi_rate_after * 100).toFixed(1)}%`}
                subtitle="Post-PID resolution"
                color="#22c55e"
              />
              <MetricCard
                label="Processing"
                value={`${result.processing_time_ms.toFixed(0)}ms`}
                subtitle="End-to-end latency"
                color="#06b6d4"
              />
            </div>

            {/* ── Model status badge ── */}
            <div className={`model-status-badge ${result.model_status === "trained" ? "status-trained" : "status-fallback"}`}>
              {result.model_status === "trained"
                ? "✓ Trained Ensemble Models Active (MLP + Random Forest)"
                : "⚠ Fallback Heuristic — Run train_models.py to activate ML"}
            </div>

            {/* ── Split view ── */}
            <div className="split-view">

              {/* Left: Safe Prescription */}
              <div className="panel panel-safe">
                <div className="panel-header panel-header-safe">
                  <div className="panel-title-row">
                    <span className="panel-icon">✅</span>
                    <h2 className="panel-title">Optimised Safe Prescription</h2>
                  </div>
                  <span className="panel-count">
                    {Object.keys(result.safe_prescription).length} drugs
                  </span>
                </div>
                <div className="panel-body">
                  {Object.keys(result.safe_prescription).length === 0 ? (
                    <p className="empty-note">
                      No medications met the {(threshold * 100).toFixed(0)}% confidence threshold.
                    </p>
                  ) : (
                    <ul className="drug-list">
                      {Object.entries(result.safe_prescription)
                        .sort(([, a], [, b]) => b - a)
                        .map(([drug, conf]) => (
                          <li key={drug} className="drug-item">
                            <div className="drug-info">
                              <span className="drug-name">{drug}</span>
                              <span className="drug-class">
                                {getDrugClass(drug)}
                              </span>
                            </div>
                            <ConfidenceBadge value={conf} />
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Right: System Interventions */}
              <div className="panel panel-alerts">
                <div className="panel-header panel-header-alerts">
                  <div className="panel-title-row">
                    <span className="panel-icon">🚨</span>
                    <h2 className="panel-title">PID-Blocked DDI Alerts</h2>
                  </div>
                  <span className="panel-count">
                    {result.system_interventions.length} blocked
                  </span>
                </div>
                <div className="panel-body">
                  {result.system_interventions.length === 0 ? (
                    <div className="safe-note">
                      <span className="safe-icon">🛡️</span>
                      <p>No high-severity interactions detected.<br />Prescription is DDI-safe.</p>
                    </div>
                  ) : (
                    <ul className="alert-list">
                      {result.system_interventions.map((alert, idx) => (
                        <li key={idx} className="alert-item">
                          <div className="alert-header">
                            <span className="alert-drugs">
                              {alert.drug_a} + {alert.drug_b}
                            </span>
                            <span className="alert-severity-badge">
                              {alert.severity} Risk
                            </span>
                          </div>
                          <div className="alert-effect">{alert.side_effect}</div>
                          <div className="alert-mechanism">{alert.mechanism}</div>
                          <div className="alert-source">Source: {alert.source}</div>
                          <div className="pid-box">
                            <div className="pid-label">PID Intervention (iter {alert.pid_iteration})</div>
                            <div className="pid-action">{alert.action_taken}</div>
                            <div className="pid-params">
                              Error: {alert.pid_error.toFixed(4)} · Output: {alert.pid_output.toFixed(4)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

            </div>

            {/* ── Alert fatigue footer ── */}
            <div className="alert-fatigue-note">
              <span className="af-icon">🔕</span>
              <span>{result.alert_fatigue_note}</span>
            </div>

          </div>
        )}

        {/* ─── FOOTER ────────────────────────────────────────────── */}
        <footer className="app-footer">
          <div className="footer-links">
            <span>HDN-DDI Framework</span>
            <span>·</span>
            <span>TwoSIDES Database</span>
            <span>·</span>
            <span>SafeDrug PID Controller</span>
            <span>·</span>
            <span>GAMENet Architecture</span>
          </div>
          <p className="footer-note">
            Investigational prototype — not approved for clinical use.
            All outputs require physician review.
          </p>
        </footer>

      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDrugClass(drug: string): string {
  const classes: Record<string, string> = {
    Lisinopril: "ACE Inhibitor · C09AA03",
    Spironolactone: "Aldosterone Antagonist · C03DA01",
    Ibuprofen: "NSAID · M01AE01",
    Omeprazole: "Proton Pump Inhibitor · A02BC01",
    Metformin: "Biguanide · A10BA02",
    Atorvastatin: "HMG-CoA Reductase Inhibitor · C10AA05",
    Amlodipine: "Calcium Channel Blocker · C08CA01",
    Amoxicillin: "Beta-lactam Antibiotic · J01CA04",
  };
  return classes[drug] ?? "Drug";
}
