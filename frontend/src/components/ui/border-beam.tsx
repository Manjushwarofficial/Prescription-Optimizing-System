import React from 'react';
import { cn } from '../../lib/utils';

interface BorderBeamProps {
  className?: string;
  size?: number;
  duration?: number;
  colorFrom?: string;
  colorTo?: string;
  borderWidth?: number;
}

export function BorderBeam({
  className,
  size = 200,
  duration = 15,
  colorFrom = '#38bdf8',
  colorTo = '#10b981',
  borderWidth = 1.5,
}: BorderBeamProps) {
  return (
    <div
      className={cn('pointer-events-none absolute inset-0 rounded-[inherit] overflow-hidden', className)}
      style={{ '--border-width': `${borderWidth}px` } as React.CSSProperties}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          border: `${borderWidth}px solid transparent`,
          backgroundImage: `conic-gradient(from var(--angle, 0deg), transparent 20%, ${colorFrom}, ${colorTo}, transparent 80%)`,
          WebkitMask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: `spin-slow ${duration}s linear infinite`,
        }}
      />
      <style>{`
        @keyframes spin-slow {
          from { --angle: 0deg; }
          to { --angle: 360deg; }
        }
        @property --angle {
          syntax: '<angle>';
          initial-value: 0deg;
          inherits: false;
        }
      `}</style>
    </div>
  );
}
