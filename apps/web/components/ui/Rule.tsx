type Props = {
  label?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
};

export function Rule({ label, align = 'left', className = '' }: Props) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden>
      {align !== 'left' && <div className="rule h-px flex-1" />}
      {label && (
        <span className="eyebrow whitespace-nowrap font-semibold text-ink-600">— {label}</span>
      )}
      {align !== 'right' && <div className="rule h-px flex-1" />}
    </div>
  );
}

export function Caret({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-block animate-tick ${className}`}>
      ▮
    </span>
  );
}
