import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', loading, disabled, className = '', children, ...rest },
  ref,
) {
  const cls = variant === 'ghost' ? 'btn-ghost' : variant === 'danger' ? 'btn-danger' : 'btn-primary';
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`${cls} ${className}`}
      {...rest}
    >
      {loading && <span aria-hidden className="animate-tick">▮</span>}
      <span>{children}</span>
    </button>
  );
});
