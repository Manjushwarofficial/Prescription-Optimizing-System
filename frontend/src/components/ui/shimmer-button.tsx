import React from 'react';
import { cn } from '../../lib/utils';

interface ShimmerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  shimmerSize?: string;
  borderRadius?: string;
  shimmerDuration?: string;
  background?: string;
  className?: string;
  children: React.ReactNode;
}

export const ShimmerButton = React.forwardRef<HTMLButtonElement, ShimmerButtonProps>(
  (
    {
      shimmerColor = '#ffffff',
      shimmerSize = '0.05em',
      shimmerDuration = '3s',
      borderRadius = '100px',
      background = 'radial-gradient(ellipse 80% 50% at 50% 120%, #0ea5e9, #0284c7)',
      className,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <button
        style={
          {
            '--spread': '90deg',
            '--shimmer-color': shimmerColor,
            '--radius': borderRadius,
            '--speed': shimmerDuration,
            '--cut': shimmerSize,
            '--bg': background,
          } as React.CSSProperties
        }
        className={cn(
          'group relative z-0 flex cursor-pointer items-center justify-center overflow-hidden whitespace-nowrap border border-white/10 px-6 py-2.5 text-white',
          '[background:var(--bg)] [border-radius:var(--radius)]',
          'transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]',
          className
        )}
        ref={ref}
        {...props}
      >
        {/* spark container */}
        <div
          className="absolute inset-0 overflow-hidden [border-radius:var(--radius)]"
        >
          {/* spark */}
          <div
            className="absolute inset-[-100%] animate-[shimmer_var(--speed)_linear_infinite]"
            style={{
              background: `conic-gradient(from calc(270deg - (var(--spread) * 0.5)), transparent 0, var(--shimmer-color) var(--spread), transparent var(--spread))`,
            }}
          />
        </div>
        {/* backdrop */}
        <div
          className="absolute [background:var(--bg)] [border-radius:var(--radius)] [inset:var(--cut)]"
        />
        <span className="relative z-10 font-semibold text-sm flex items-center gap-2">{children}</span>
        <style>{`
          @keyframes shimmer {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </button>
    );
  }
);
ShimmerButton.displayName = 'ShimmerButton';
