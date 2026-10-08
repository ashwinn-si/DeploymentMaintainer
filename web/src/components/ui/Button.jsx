import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const SIZES = {
  sm: 'min-h-[44px] px-3.5 py-1.5 text-sm',
  md: 'min-h-[44px] px-5 py-2.5 text-sm sm:text-base',
  lg: 'min-h-[48px] px-6 py-3 text-base',
  icon: 'min-h-[44px] min-w-[44px] p-2.5',
};

const VARIANTS = {
  primary: 'btn-primary-cta',
  ghost: 'btn-quiet',
  danger: 'bg-error text-error-content hover:brightness-95 shadow-md shadow-error/20',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest },
  ref
) {
  const classes = [
    'btn-base inline-flex items-center justify-center gap-2',
    'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--premium-ring)]',
    SIZES[size] ?? SIZES.md,
    VARIANTS[variant] ?? VARIANTS.primary,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
});
