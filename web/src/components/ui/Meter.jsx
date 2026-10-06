import { motion } from 'framer-motion';

function thresholdColor(value) {
  if (value > 90) return 'rose';
  if (value >= 70) return 'amber';
  return 'teal';
}

const BAR_COLORS = {
  teal: 'bg-teal-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
};

const RING_COLORS = {
  teal: 'stroke-teal-500',
  amber: 'stroke-amber-500',
  rose: 'stroke-rose-500',
};

export function Meter({ label, value, unit = '%', className = '' }) {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  const tone = thresholdColor(clamped);
  return (
    <div className={['space-y-1.5', className].join(' ')}>
      <div className="flex items-center justify-between text-xs">
        {label ? <span className="font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</span> : <span />}
        <span className="font-medium text-[var(--text-primary)]">
          {Math.round(clamped)}
          {unit}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
        <motion.div
          className={['h-full rounded-full', BAR_COLORS[tone]].join(' ')}
          initial={{ width: 0 }}
          animate={{ width: `${clamped}%` }}
          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
        />
      </div>
    </div>
  );
}

export function Ring({ value, size = 160, stroke = 10, label, sublabel }) {
  const clamped = Math.min(100, Math.max(0, value ?? 0));
  const tone = thresholdColor(clamped);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const target = circumference * (1 - clamped / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="text-black/[0.07] dark:text-white/[0.08]" stroke="currentColor" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={RING_COLORS[tone]}
          stroke="currentColor"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: target }}
          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1], delay: 0.15 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-2 text-center">
        <span className="text-2xl font-bold tracking-tight text-[var(--text-primary)] sm:text-3xl leading-none">
          {Math.round(clamped)}%
        </span>
        {label ? (
          <span className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

