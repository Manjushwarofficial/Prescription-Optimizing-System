import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

interface BlurFadeProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  yOffset?: number;
  inView?: boolean;
}

export function BlurFade({
  children,
  className,
  delay = 0,
  duration = 0.4,
  yOffset = 6,
  inView = false,
}: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(inView);

  useEffect(() => {
    if (inView) { setVisible(true); return; }
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.1 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [inView]);

  return (
    <div
      ref={ref}
      className={cn(className)}
      style={{
        opacity: visible ? 1 : 0,
        filter: visible ? 'blur(0px)' : 'blur(6px)',
        transform: visible ? 'translateY(0)' : `translateY(${yOffset}px)`,
        transition: `opacity ${duration}s ease ${delay}s, filter ${duration}s ease ${delay}s, transform ${duration}s ease ${delay}s`,
        willChange: 'opacity, filter, transform',
      }}
    >
      {children}
    </div>
  );
}
