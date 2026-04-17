export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 text-ink-400">
      <span className="animate-tick font-mono">▮</span>
      <span className="eyebrow">{label}…</span>
    </div>
  );
}
