import React from 'react';
import { ShieldCheck, Stethoscope, Dna, BarChart3, ExternalLink, Activity } from 'lucide-react';
import { cn } from '../lib/utils';

interface HeaderProps {
  activeTab: 'cpoe' | 'brics' | 'benchmarks';
  setActiveTab: (tab: 'cpoe' | 'brics' | 'benchmarks') => void;
}

const tabs = [
  { id: 'cpoe'       as const, label: 'CPOE & Alert Firewall',    icon: Stethoscope },
  { id: 'brics'      as const, label: 'Molecular Explorer',        icon: Dna          },
  { id: 'benchmarks' as const, label: 'Research Benchmarks',       icon: BarChart3    },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  return (
    <header className="flex-shrink-0 z-30 bg-[#09090B] border-b border-zinc-800/60 px-5 h-14 flex items-center justify-between gap-4">

      {/* ── Brand ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Logo mark: simple shield with 1px border, sky accent */}
        <div className="relative w-8 h-8 rounded-lg border border-zinc-700 flex items-center justify-center bg-zinc-900">
          <ShieldCheck className="w-4 h-4 text-sky-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold tracking-tight text-white leading-none">
              SafeAudit-CDSS
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 leading-none">
              v1.0
            </span>
          </div>
          <p className="text-[10px] text-zinc-500 leading-none mt-0.5 hidden sm:block">
            Drug-Drug Interaction Firewall · MIMIC-III
          </p>
        </div>
      </div>

      {/* ── Center Nav ───────────────────────────────────────────── */}
      <nav className="flex items-center gap-0.5 bg-zinc-900 border border-zinc-800 p-0.5 rounded-xl">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200',
                active
                  ? 'bg-sky-500 text-white shadow-sm shadow-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
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
        {/* Reference chips — desktop only */}
        <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-zinc-500">
          {['SafeDrug \'21', 'GAMENet \'19', 'Poly \'20'].map((ref) => (
            <span key={ref} className="px-2 py-0.5 rounded border border-zinc-800 font-mono">
              {ref}
            </span>
          ))}
        </div>

        {/* Live status */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-800/60 bg-emerald-500/5 text-emerald-400 text-[11px] font-medium">
          <Activity className="w-3 h-3" />
          <span className="hidden sm:inline">AI Active</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-fast" />
        </div>

        {/* Docs link */}
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          title="FastAPI Swagger Docs"
          className="w-8 h-8 rounded-lg border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:border-zinc-600 transition-all"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </header>
  );
};
