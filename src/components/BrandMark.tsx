export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size, borderRadius: size * 0.3 }} aria-hidden>
      <svg width={size * 0.56} height={size * 0.56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
        <path d="M6.5 15.5c1.2 1.6 3 2.5 5.3 2.5 2.6 0 4.4-1.3 4.4-3.3 0-4.2-9.4-2.2-9.4-6.3 0-1.8 1.8-3.1 4.2-3.1 2 0 3.6.8 4.6 2.2" />
      </svg>
    </span>
  );
}
