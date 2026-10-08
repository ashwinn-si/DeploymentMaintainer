export function PageHeader({ icon: Icon, eyebrow, title, actions, children }) {
  return (
    <div className="surface relative overflow-hidden rounded-2xl animate-fade-in-up">
      <div className="app-surface-header absolute inset-0" />
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
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:text-3xl lg:text-4xl">
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
