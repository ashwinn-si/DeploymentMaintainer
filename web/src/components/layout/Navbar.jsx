import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, Rocket } from 'lucide-react';
import { SidebarContent } from './Sidebar.jsx';

export function Navbar({ deploying = false }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <header className="glass-mid sticky top-0 z-30 flex items-center gap-3 border-b border-white/60 px-4 py-2.5 shadow-sm backdrop-blur-2xl dark:border-white/10 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl glass-light border border-white/60 shadow-xs transition-colors hover:bg-black/5 active:scale-95 dark:border-white/10 dark:hover:bg-white/10"
        >
          <Menu className="h-4 w-4 text-[var(--text-muted)]" />
        </button>
        <div className="flex items-center gap-2 font-heading text-base">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand-soft)] text-[var(--brand)]">
            <Rocket className="h-3.5 w-3.5" />
          </div>
          <span className="text-[var(--text-primary)]">Deploy</span>
          <span className="font-light text-[var(--brand)]">Maintainer</span>
        </div>
      </header>

      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="glass-strong absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-white/60 shadow-2xl backdrop-blur-2xl dark:border-white/10"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              <SidebarContent deploying={deploying} onNavigate={() => setOpen(false)} />
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
