export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="glass-light flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-[var(--text-muted)]">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
