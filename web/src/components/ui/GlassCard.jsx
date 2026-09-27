import { motion } from 'framer-motion';

const VARIANTS = {
  strong: 'glass-strong rounded-3xl',
  mid: 'glass-mid rounded-3xl',
  light: 'glass-light rounded-2xl',
};

export function GlassCard({
  as: Component = motion.div,
  variant = 'mid',
  interactive = false,
  className = '',
  children,
  ...rest
}) {
  const classes = [
    VARIANTS[variant] ?? VARIANTS.mid,
    'p-5 sm:p-6 transition-colors duration-200',
    interactive ? 'glass-interactive cursor-pointer' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const motionProps = interactive
    ? { whileHover: { y: -2 }, whileTap: { scale: 0.99 } }
    : {};

  return (
    <Component
      className={classes}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      {...motionProps}
      {...rest}
    >
      {children}
    </Component>
  );
}
