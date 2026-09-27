export function Loader({ label = 'Loading…' }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-4 py-10">
      <div className="absolute h-24 w-24 rounded-full bg-[var(--brand-soft)] blur-2xl" />
      <div className="relative flex h-16 w-16 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-[var(--brand)]/10" />
        <span className="absolute inset-2 rounded-full border-2 border-[var(--brand)]/20" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--brand)]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[var(--brand)] shadow-[0_0_12px_var(--brand)]" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-1 animate-bounce rounded-full bg-[var(--brand)]"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
