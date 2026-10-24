"use client";

import { useEffect, useRef, useState } from "react";

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Animates a number from 0 (or its previous value) to `value`, like the
 * dashboard reference. Respects reduced motion and renders the final value on the server.
 */
export function CountUp({ value, duration = 900, format, className }: { value: number; duration?: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = first.current ? 0 : from.current;
    first.current = false;
    if (reduce || start === value) {
      setShown(value);
      from.current = value;
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const v = start + (value - start) * easeOutExpo(p);
      setShown(p >= 1 ? value : v);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    setShown(start);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  const isInt = Number.isInteger(value);
  const text = format ? format(shown) : isInt ? Math.round(shown).toLocaleString("he-IL") : shown.toFixed(1);
  return (
    <span className={className} aria-label={format ? format(value) : String(value)}>
      <span aria-hidden>{text}</span>
    </span>
  );
}
