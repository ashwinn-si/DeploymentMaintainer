import { useEffect, useState } from 'react';
import { Logo } from '../ui/Logo.jsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useOptionalServer } from '../../context/ServerContext.jsx';
import { SidebarContent } from './Sidebar.jsx';

export function Navbar({ deploying = false }) {
  const [open, setOpen] = useState(false);
  const ctx = useOptionalServer();

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
      <header className="surface-overlay sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--premium-border)] px-4 py-2.5 shadow-sm backdrop-blur-2xl lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl surface-inset border border-[var(--premium-border)] shadow-xs transition-colors hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"
        >
          <Menu className="h-4 w-4 text-[var(--text-muted)]" />
        </button>
        <div className="flex items-center gap-2 font-heading text-base">
          <Logo className="h-7 w-auto" />
          <span className="text-[var(--text-primary)]">Deploy</span>
          <span className="font-light text-[var(--brand)]">Maintainer</span>
        </div>
        {ctx ? (
          <span className="ml-auto min-w-0 max-w-[40%] truncate rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-xs font-medium text-[var(--brand)]">
            {ctx.server.name}
          </span>
        ) : null}
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
              className="surface-sidebar absolute inset-y-0 left-0 w-72 max-w-[85vw] rounded-r-3xl"
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.4, right: 0 }}
              onDragEnd={(_, info) => {
                if (info.offset.x < -80 || info.velocity.x < -400) setOpen(false);
              }}
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"
              >
                <X className="h-4.5 w-4.5" />
              </button>
              <SidebarContent deploying={deploying} onNavigate={() => setOpen(false)} />
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
