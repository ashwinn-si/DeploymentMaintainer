import { useState } from 'react';
import toast from 'react-hot-toast';
import { UserCog, KeyRound } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { GlassCard } from '../components/ui/GlassCard.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useAuth } from '../context/AuthContext.jsx';
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

export function Account() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <PageHeader icon={UserCog} eyebrow="Dashboard" title="Account">
        {user?.email ? `Signed in as ${user.email}.` : 'Your dashboard login.'}
      </PageHeader>
      <PasswordCard />
    </div>
  );
}
