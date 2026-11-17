import React from 'react';
import { ShieldAlert, Stethoscope, Dna, BarChart3, ExternalLink } from 'lucide-react';

interface HeaderProps {
  activeTab: 'cpoe' | 'brics' | 'benchmarks';
  setActiveTab: (tab: 'cpoe' | 'brics' | 'benchmarks') => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="bg-slate-900 border-b border-slate-800 px-6 py-3 flex-shrink-0 flex items-center justify-between z-30 shadow-lg">
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 via-indigo-600 to-rose-600 p-[2px] flex items-center justify-center shadow-lg shadow-sky-500/20">
            <div className="w-full h-full bg-slate-900 rounded-[10px] flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-sky-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                SafeAudit-CDSS
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  v1.0.0
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Molecular Substructure Graph & Confidence-Calibrated Alert-Fatigue Firewall
            </p>
          </div>
        </div>

        <div className="hidden lg:flex items-center pl-4 border-l border-slate-800 space-x-2 text-xs text-slate-400">
          <span className="px-2 py-1 rounded bg-slate-800/80 border border-slate-700/50">SafeDrug (IJCAI '21)</span>
          <span className="px-2 py-1 rounded bg-slate-800/80 border border-slate-700/50">GAMENet (AAAI '19)</span>
          <span className="px-2 py-1 rounded bg-slate-800/80 border border-slate-700/50">Poly et al. (JMIR '20)</span>
        </div>
      </div>

      {/* Center Navigation Tabs */}
      <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
        <button
          onClick={() => setActiveTab('cpoe')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${
            activeTab === 'cpoe'
              ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Stethoscope className="w-4 h-4" />
          <span>1. Live CPOE & Alert Firewall</span>
        </button>

        <button
          onClick={() => setActiveTab('brics')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${
            activeTab === 'brics'
              ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Dna className="w-4 h-4" />
          <span>2. Molecular & BRICS Explorer</span>
        </button>

        <button
          onClick={() => setActiveTab('benchmarks')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center space-x-2 ${
            activeTab === 'benchmarks'
              ? 'bg-sky-600 text-white shadow-md shadow-sky-600/30'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>3. Research Benchmarks & ROC</span>
        </button>
      </div>

      {/* Right Status Badges */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-fast"></span>
          <span className="font-medium">AI Firewall Active</span>
        </div>
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          title="FastAPI Interactive Swagger Docs"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </header>
  );
};
