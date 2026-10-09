import { useState } from 'react';
import { Logo } from '../ui/Logo.jsx';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutGrid,
  PlusCircle,
  Rocket,
  Plug,
  Server,
  Settings,
  LogOut,
  Layers,
  UserCog,
  PanelLeftClose,
  PanelLeftOpen,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOptionalServer } from '../../context/ServerContext.jsx';
import { useServers } from '../../context/ServersContext.jsx';
import { SelectSheet } from '../ui/SelectSheet.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

// Grouped by what the user is doing, each with a one-line explanation so the names are self-evident.
const SERVER_NAV_GROUPS = [
  {
    heading: 'Projects',
    items: [
      { path: '/', label: 'Apps', desc: 'Everything deployed here', icon: LayoutGrid, end: true },
      { path: '/new', label: 'New app', desc: 'Deploy a GitHub repo', icon: PlusCircle },
      { path: '/deployments', label: 'Deployments', desc: 'Each deploy run and its logs', icon: Rocket, dot: true },
    ],
  },
  {
    heading: 'This server',
    items: [
      { path: '/ports', label: 'Ports & routes', desc: 'Port and URL path per app', icon: Plug },
      { path: '/server', label: 'Resources', desc: 'CPU, memory and disk', icon: Server },
      { path: '/settings', label: 'Server settings', desc: 'Connection, backup, cleanup', icon: Settings },
    ],
  },
];

const ACCOUNT_NAV = [
  { path: '/', label: 'All servers', desc: 'Switch or add servers', icon: Layers, end: true },
  { path: '/settings', label: 'Account', desc: 'Your login and password', icon: UserCog },
  { path: '/about', label: 'About', desc: 'The project, GitHub, developer', icon: Info },
];

const ALL_SERVERS = '__all__';

const DOT = {
  online: 'bg-teal-500',
  unauthorized: 'bg-amber-500',
  offline: 'bg-rose-500',
};

function navClass({ isActive }) {
  return [
    'flex items-center gap-3 rounded-2xl transition-colors duration-200',
    isActive
      ? 'bg-[var(--brand)] text-white font-semibold shadow-sm'
      : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5',
  ].join(' ');
}

function NavItem({ item, to, collapsed, onNavigate, pulse = false }) {
  const { label, desc, icon: Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      title={collapsed ? `${label} — ${desc}` : desc}
      className={(navState) =>
        [navClass(navState), collapsed ? 'mx-auto h-11 w-11 justify-center p-0' : 'px-4 py-2.5'].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="h-4.5 w-4.5 shrink-0" />
          {!collapsed ? (
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">{label}</span>
              <span className={['block truncate text-[11px] leading-tight', isActive ? 'text-white/80' : 'text-[var(--text-muted)]'].join(' ')}>{desc}</span>
            </span>
          ) : null}
          {!collapsed && pulse ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--brand)]" /> : null}
        </>
      )}
    </NavLink>
  );
}

function ServerOption({ name, status }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={['h-2 w-2 shrink-0 rounded-full', DOT[status] ?? 'bg-[var(--text-muted)]'].join(' ')} />
      <span className="truncate">{name}</span>
    </span>
  );
}

function ServerSwitcher({ onNavigate, collapsed }) {
  const navigate = useNavigate();
  const ctx = useOptionalServer();
  const { servers } = useServers();

  const options = [
    ...(servers ?? []).map((s) => ({ value: s.id, label: <ServerOption name={s.name} status={s.status} /> })),
    {
      value: ALL_SERVERS,
      label: (
        <span className="flex items-center gap-2">
          <Layers className="h-3.5 w-3.5 text-[var(--text-muted)]" />
          All servers
        </span>
      ),
    },
  ];

  const handleChange = (value) => {
    onNavigate?.();
    if (value === ALL_SERVERS) navigate('/');
    else if (value !== ctx?.server.id) navigate(`/s/${value}`);
  };

  if (collapsed) {
    return (
      <div className="mb-4 flex justify-center" title={`Current Server: ${ctx?.server.name || 'Select Server'}`}>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex h-10 w-10 items-center justify-center rounded-xl surface-inset border border-[var(--premium-border)] text-[var(--brand)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          <Server className="h-5 w-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <SelectSheet
        label="Server"
        value={ctx?.server.id ?? ''}
        onChange={handleChange}
        options={options}
        placeholder={servers === null ? 'Loading servers…' : 'Select a server'}
      />
    </div>
  );
}

export function SidebarContent({ deploying = false, onNavigate, collapsed = false, onToggleCollapse }) {
  const { user, logout } = useAuth();
  const ctx = useOptionalServer();

  return (
    <div className={`flex h-full flex-col transition-all duration-300 ${collapsed ? 'p-3' : 'p-6'}`}>
      <div className={`mb-6 flex items-center justify-between gap-2 ${collapsed ? 'px-0 flex-col gap-3' : 'px-1'}`}>
        <Link to="/" onClick={onNavigate} aria-label="Go to home" className="flex items-center gap-2">
          <Logo className="h-9 w-auto shrink-0" />
          {!collapsed ? (
            <span className="font-heading text-lg leading-tight">
              <span className="text-[var(--text-primary)]">Deploy</span>{' '}
              <span className="font-light text-[var(--brand)]">Maintainer</span>
            </span>
          ) : null}
        </Link>
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        ) : null}
      </div>

      <ServerSwitcher onNavigate={onNavigate} collapsed={collapsed} />

      <nav className="custom-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto">
        {ctx
          ? SERVER_NAV_GROUPS.map((group) => (
              <div key={group.heading} className="space-y-1">
                {!collapsed ? (
                  <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{group.heading}</p>
                ) : (
                  <div className="mx-auto my-2 h-px w-6 bg-[var(--premium-border)]" />
                )}
                {group.items.map((item) => (
                  <NavItem key={item.path} item={item} to={ctx.serverPath(item.path)} collapsed={collapsed} onNavigate={onNavigate} pulse={item.dot && deploying} />
                ))}
              </div>
            ))
          : null}
      </nav>

      <div className="mt-4 space-y-1 border-t border-[var(--premium-border)] pt-4">
        {!collapsed ? <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Workspace</p> : null}
        {ACCOUNT_NAV.map((item) => (
          <NavItem key={item.label} item={item} to={item.path} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {!collapsed ? (
          <>
            <div className="surface-inset flex items-center justify-between rounded-2xl border border-[var(--premium-border)] px-4 py-3 shadow-xs">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Theme</span>
              <ThemeToggle />
            </div>
            <div className="surface-inset space-y-2 rounded-2xl border border-[var(--premium-border)] p-4 shadow-xs">
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
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={logout}
              title={`Log out (${user?.email})`}
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-rose-500/10 hover:text-rose-500"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Sidebar({ deploying = false, collapsed = false, onToggleCollapse }) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-20 hidden surface-overlay border-r border-[var(--premium-border)] lg:flex transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-72'
      }`}
    >
      <SidebarContent deploying={deploying} collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
    </aside>
  );
}

