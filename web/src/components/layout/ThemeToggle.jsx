import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext.jsx';

export function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className={[
        'flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl border shadow-xs ui-transition',
        'surface-inset border-[var(--premium-border)] hover:bg-black/5 active:scale-95 dark:hover:bg-white/10',
        className,
      ].join(' ')}
    >
      {isDark ? <Sun className="h-4 w-4 text-[var(--text-muted)]" /> : <Moon className="h-4 w-4 text-[var(--text-muted)]" />}
    </button>
  );
}
