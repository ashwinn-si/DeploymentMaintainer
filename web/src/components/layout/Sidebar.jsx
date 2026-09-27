import { NavLink } from 'react-router-dom';
import { LayoutGrid, PlusCircle, Rocket, Plug, Server, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Apps', icon: LayoutGrid, end: true },
  { to: '/new', label: 'New App', icon: PlusCircle },
  { to: '/deployments', label: 'Deployments', icon: Rocket, dot: true },
  { to: '/ports', label: 'Ports', icon: Plug },
  { to: '/server', label: 'Server', icon: Server },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function SidebarContent({ deploying = false, onNavigate }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-8 flex items-center gap-2 px-1">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Rocket className="h-4.5 w-4.5" />
        </div>
        <span className="font-heading text-lg leading-tight">
          <span className="text-[var(--text-primary)]">Deploy</span>{' '}
          <span className="font-light text-[var(--brand)]">Maintainer</span>
        </span>
      </div>

      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end, dot }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors duration-200',
                isActive
                  ? 'bg-[var(--brand)] text-white shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5',
              ].join(' ')
            }
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            <span className="flex-1">{label}</span>
            {dot && deploying ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--brand)]" /> : null}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 space-y-3">
        <div className="glass-light flex items-center justify-between rounded-2xl border border-white/60 px-4 py-3 shadow-xs dark:border-white/10">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Theme</span>
          <ThemeToggle />
        </div>
        <div className="glass-light space-y-2 rounded-2xl border border-white/60 p-4 shadow-xs dark:border-white/10">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{user?.email}</p>
          <button
            type="button"
            onClick={logout}
            className="flex min-h-[38px] w-full items-center gap-2 rounded-xl px-2 text-sm font-medium text-[var(--text-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-500"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ deploying = false }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 glass-strong border-r border-white/60 dark:border-white/10 lg:flex">
      <SidebarContent deploying={deploying} />
    </aside>
  );
}
