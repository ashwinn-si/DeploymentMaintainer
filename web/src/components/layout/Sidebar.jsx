import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useOptionalServer } from '../../context/ServerContext.jsx';
import { useServers } from '../../context/ServersContext.jsx';
import { SelectSheet } from '../ui/SelectSheet.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';

const SERVER_NAV = [
  { path: '/', label: 'Apps', icon: LayoutGrid, end: true },
  { path: '/new', label: 'New App', icon: PlusCircle },
  { path: '/deployments', label: 'Deployments', icon: Rocket, dot: true },
  { path: '/ports', label: 'Ports', icon: Plug },
  { path: '/server', label: 'Server', icon: Server },
  { path: '/settings', label: 'Settings', icon: Settings },
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
      ? 'bg-[var(--brand)] text-white dark:text-[#0B0D11] font-semibold shadow-sm'
      : 'text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5',
  ].join(' ');
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
          className="flex h-10 w-10 items-center justify-center rounded-xl glass-light border border-white/60 dark:border-white/10 text-[var(--brand)] hover:bg-black/5 dark:hover:bg-white/10"
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
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Rocket className="h-4.5 w-4.5" />
          </div>
          {!collapsed ? (
            <span className="font-heading text-lg leading-tight">
              <span className="text-[var(--text-primary)]">Deploy</span>{' '}
              <span className="font-light text-[var(--brand)]">Maintainer</span>
            </span>
          ) : null}
        </div>
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

      <nav className="custom-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto">
        {ctx
          ? SERVER_NAV.map(({ path, label, icon: Icon, end, dot }) => (
              <NavLink
                key={path}
                to={ctx.serverPath(path)}
                end={end}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                className={(navState) =>
                  [
                    navClass(navState),
                    collapsed ? 'h-11 w-11 justify-center mx-auto p-0' : 'px-4 py-3 text-sm font-medium',
                  ].join(' ')
                }
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                {!collapsed ? <span className="flex-1">{label}</span> : null}
                {!collapsed && dot && deploying ? (
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--brand)]" />
                ) : null}
              </NavLink>
            ))
          : null}
      </nav>

      <div className="mt-4 space-y-1 border-t border-black/[0.06] pt-4 dark:border-white/10">
        <NavLink
          to="/"
          end
          onClick={onNavigate}
          title={collapsed ? 'Servers' : undefined}
          className={(navState) =>
            [
              navClass(navState),
              collapsed ? 'h-11 w-11 justify-center mx-auto p-0' : 'px-4 py-3 text-sm font-medium',
            ].join(' ')
          }
        >
          <Layers className="h-4.5 w-4.5 shrink-0" />
          {!collapsed ? <span className="flex-1">Servers</span> : null}
        </NavLink>
        <NavLink
          to="/settings"
          onClick={onNavigate}
          title={collapsed ? 'Account' : undefined}
          className={(navState) =>
            [
              navClass(navState),
              collapsed ? 'h-11 w-11 justify-center mx-auto p-0' : 'px-4 py-3 text-sm font-medium',
            ].join(' ')
          }
        >
          <UserCog className="h-4.5 w-4.5 shrink-0" />
          {!collapsed ? <span className="flex-1">Account</span> : null}
        </NavLink>
      </div>

      <div className="mt-4 space-y-3">
        {!collapsed ? (
          <>
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
      className={`fixed inset-y-0 left-0 z-20 hidden glass-strong border-r border-white/60 dark:border-white/10 lg:flex transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-72'
      }`}
    >
      <SidebarContent deploying={deploying} collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
    </aside>
  );
}

