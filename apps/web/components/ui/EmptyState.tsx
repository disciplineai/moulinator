export function EmptyState({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="paper-plain flex flex-col items-start gap-4 px-6 py-8 text-ink">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h3 className="font-display text-xl text-balance">{title}</h3>
      {description && <p className="max-w-prose text-sm text-ink-400">{description}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
