import { forwardRef, type InputHTMLAttributes, useId } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  hint?: string;
  error?: string | null;
  trailing?: React.ReactNode;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, trailing, className = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy: string[] = [];
  if (hint) describedBy.push(`${inputId}-hint`);
  if (error) describedBy.push(`${inputId}-err`);
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="field-label">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy.length ? describedBy.join(' ') : undefined}
          className={`input ${error ? '!border-rust' : ''} ${trailing ? 'pr-10' : ''} ${className}`}
          {...rest}
        />
        {trailing && (
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-400">
            {trailing}
          </div>
        )}
      </div>
      {hint && !error && (
        <p id={`${inputId}-hint`} className="eyebrow mt-2 normal-case tracking-[0.06em] text-ink-400 font-normal">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-err`} className="mt-2 text-xs tracking-[0.06em] text-rust">
          — {error}
        </p>
      )}
    </div>
  );
});
