import React from 'react';
import { ShieldCheck, Stethoscope, Dna, BarChart3, ExternalLink, Activity } from 'lucide-react';
import { cn } from '../lib/utils';

interface HeaderProps {
  activeTab: 'cpoe' | 'brics' | 'benchmarks';
  setActiveTab: (tab: 'cpoe' | 'brics' | 'benchmarks') => void;
}

const tabs = [
  { id: 'cpoe'       as const, label: '1. CPOE & Alert Firewall',    icon: Stethoscope },
  { id: 'brics'      as const, label: '2. Molecular & BRICS Explorer', icon: Dna          },
  { id: 'benchmarks' as const, label: '3. Research Benchmarks',       icon: BarChart3    },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="flex-shrink-0 z-30 bg-[#0B1120] border-b border-slate-800 px-6 h-14 flex items-center justify-between gap-4 shadow-sm">

      {/* ── Brand ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3.5 flex-shrink-0">
        <div className="relative w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center shadow-glow-sky">
          <ShieldCheck className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-extrabold tracking-tight text-white leading-none">
              SafeAudit<span className="text-sky-400 font-semibold">-CDSS</span>
            </span>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30 leading-none">
              v1.0.0
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-none mt-1 hidden sm:block font-medium">
            Molecular Substructure Graph & Alert-Fatigue Firewall
          </p>
        </div>
      </div>

      {/* ── Center Nav ───────────────────────────────────────────── */}
      <nav className="flex items-center gap-1 bg-[#131F38] border border-slate-700/60 p-1 rounded-xl shadow-inner">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'relative flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 cursor-pointer',
                active
                  ? 'bg-sky-600 text-white shadow-md shadow-sky-600/40 border border-sky-400/40'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              )}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="hidden md:inline">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Right Status ─────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-400">
          {['SafeDrug \'21', 'GAMENet \'19', 'Poly et al. \'20'].map((ref) => (
            <span key={ref} className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700/60 font-mono text-[10px]">
              {ref}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs font-semibold shadow-sm">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="hidden sm:inline">AI Firewall Active</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-fast ml-0.5" />
        </div>

        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          title="FastAPI Swagger Documentation"
          className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-700/80 flex items-center justify-center text-slate-300 hover:text-white hover:border-sky-500 hover:bg-slate-800 transition-all cursor-pointer"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </header>
  );
};
