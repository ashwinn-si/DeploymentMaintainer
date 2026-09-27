export function PageHeader({ icon: Icon, eyebrow, title, actions, children }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/70 shadow-sm dark:border-white/[0.08] sm:rounded-3xl">
      <div className="absolute inset-0 bg-white/60 backdrop-blur-xl dark:bg-white/[0.04]" />
      <div className="pointer-events-none absolute -top-12 -right-12 h-48 w-48 rounded-full bg-[var(--brand-soft)] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-[var(--brand-soft)] opacity-70 blur-3xl" />
      <div className="absolute inset-y-4 left-0 w-1 rounded-full bg-gradient-to-b from-[var(--brand)] to-transparent opacity-80" />

      <div className="relative z-10 flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
        <div className="flex items-center gap-4">
          {Icon ? (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
              <Icon className="h-5 w-5" />
            </div>
          ) : null}
          <div className="space-y-1.5">
            {eyebrow ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
                {eyebrow}
              </span>
            ) : null}
            <h1 className="text-2xl font-medium leading-tight tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
              {title}
            </h1>
            {children ? <p className="text-sm text-[var(--text-secondary)]">{children}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
      </div>
    </div>
  );
}
