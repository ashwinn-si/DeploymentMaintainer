import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const SIZES = {
  sm: 'min-h-[44px] px-3.5 py-1.5 text-sm rounded-xl',
  md: 'min-h-[44px] px-5 py-2.5 text-sm sm:text-base rounded-2xl',
  lg: 'min-h-[48px] px-6 py-3 text-base rounded-2xl',
  icon: 'min-h-[44px] min-w-[44px] p-2.5 rounded-xl',
};

const VARIANTS = {
  primary:
    'text-white dark:text-[#0B140F] font-semibold shadow-md shadow-black/10 dark:shadow-black/30 bg-[var(--brand)] hover:brightness-110',
  ghost: 'btn-ghost',
  danger: 'bg-rose-500/90 text-white hover:bg-rose-600 shadow-md shadow-rose-500/20',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, className = '', children, ...rest },
  ref
) {
  const classes = [
    'btn-base inline-flex items-center justify-center gap-2',
    'active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50',
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
