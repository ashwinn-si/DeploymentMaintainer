import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { Settings as SettingsIcon, KeyRound, Palette, Sun, Moon, Info, LogOut, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { accountApi, ApiError } from '../api.js';

function PasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit = currentPassword && newPassword.length >= 12 && newPassword === confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await accountApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed — you stay signed in on this device.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlassCard variant="mid">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <KeyRound className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Change password</h2>
          <p className="text-xs text-[var(--text-muted)]">Signs out your other devices.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Current password"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <Input
          label="New password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint="At least 12 characters"
          autoComplete="new-password"
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={mismatch ? "Passwords don't match" : undefined}
          autoComplete="new-password"
          required
        />
        {error ? <p className="text-sm text-rose-500">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" loading={loading} disabled={!canSubmit}>
            Change password
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  return (
    <GlassCard variant="mid">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-soft)] text-[var(--brand)]">
          <Palette className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Appearance</h2>
          <p className="text-xs text-[var(--text-muted)]">Saved on this device.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Theme">
        {THEMES.map(({ value, label, icon: Icon }) => {
          const active = theme === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              className={[
                'flex min-h-[44px] items-center justify-center gap-2 rounded-xl border text-sm font-medium ui-transition active:scale-[0.98]',
                active
                  ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                  : 'surface-inset border-[var(--premium-border)] text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/10',
              ].join(' ')}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>
    </GlassCard>
  );
}

function RowLink({ icon: Icon, title, desc, to, onClick, danger = false }) {
  const className = [
    'flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left ui-transition',
    danger ? 'hover:bg-rose-500/10' : 'hover:bg-black/5 dark:hover:bg-white/5',
  ].join(' ');
  const body = (
    <>
      <Icon className={['h-4.5 w-4.5 shrink-0', danger ? 'text-rose-500' : 'text-[var(--text-muted)]'].join(' ')} />
      <span className="min-w-0 flex-1">
        <span className={['block text-sm font-semibold', danger ? 'text-rose-500' : 'text-[var(--text-primary)]'].join(' ')}>{title}</span>
        <span className="block truncate text-xs text-[var(--text-muted)]">{desc}</span>
      </span>
      {to ? <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" /> : null}
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

export function Settings() {
  const { logout } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader icon={SettingsIcon} eyebrow="Dashboard" title="Settings">
        Theme, your login and more.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <AppearanceCard />
          <GlassCard variant="mid" className="p-2! sm:p-2!">
            <RowLink icon={Info} title="About" desc="The project, GitHub, developer" to="/about" />
            <RowLink icon={LogOut} title="Log out" desc="Sign out of this device" onClick={logout} danger />
          </GlassCard>
        </div>
        <PasswordCard />
      </div>
    </div>
  );
}
