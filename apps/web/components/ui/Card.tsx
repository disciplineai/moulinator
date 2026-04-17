import type { HTMLAttributes } from 'react';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: 'paper' | 'plain' | 'ink';
};

export function Card({ tone = 'plain', className = '', children, ...rest }: CardProps) {
  const base =
    tone === 'paper'
      ? 'paper'
      : tone === 'ink'
        ? 'bg-ink text-parchment-50'
        : 'paper-plain';
  return (
    <div className={`${base} rounded-[2px] ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  eyebrow,
  title,
  right,
  className = '',
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-4 border-b border-ink/10 px-6 py-4 ${className}`}>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <h2 className="font-display text-xl font-medium text-ink">{title}</h2>}
      </div>
      {right}
    </div>
  );
}

export function CardBody({ className = '', children }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-6 py-5 ${className}`}>{children}</div>;
}
