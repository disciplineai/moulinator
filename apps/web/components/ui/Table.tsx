import type { HTMLAttributes, ThHTMLAttributes, TdHTMLAttributes } from 'react';

export function Table({ className = '', children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b-2 border-ink">{children}</thead>;
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ className = '', children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={`border-b border-ink/10 hover:bg-parchment-50 ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function Th({ className = '', children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-4 py-2.5 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-600 ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ className = '', children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-4 py-3 align-middle font-mono text-sm text-ink ${className}`} {...rest}>
      {children}
    </td>
  );
}
