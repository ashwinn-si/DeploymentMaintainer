import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false
  );
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 639px)');
    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const sheetRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isMobile = useIsMobile();

  // Depends on `open` only: re-running on every onClose identity change would steal focus from inputs while typing.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = sheetRef.current?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    (focusable ?? sheetRef.current)?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[9999] flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm dark:bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            drag={isMobile ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100 || info.velocity.y > 400) onClose?.();
            }}
            initial={{ y: '100%', scale: 0.98, opacity: 0.8 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: '100%', scale: 0.98, opacity: 0.8 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            className={[
              'relative flex w-full flex-col overflow-hidden',
              'max-h-[90dvh] sm:max-h-[85vh]',
              'rounded-t-[28px] sm:rounded-3xl',
              'border border-white/80 dark:border-white/10',
              'bg-gradient-to-b from-white/95 via-[#F8FAF8]/92 to-[#EEF5EF]/95',
              'dark:from-[#112017]/95 dark:via-[#0E1A13]/95 dark:to-[#0A140F]/95',
              'backdrop-blur-2xl shadow-[0_25px_60px_-15px_rgba(20,50,30,0.2)]',
              SIZES[size] ?? SIZES.md,
            ].join(' ')}
          >
            <div className="pointer-events-none absolute -top-16 -right-16 h-56 w-56 rounded-full bg-[var(--brand-soft)] blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-[var(--brand-soft)] opacity-70 blur-3xl" />

            <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-neutral-300/80 dark:bg-neutral-600/60 sm:hidden" />

            {title ? (
              <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] bg-white/40 px-6 py-4 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.02]">
                <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl">{title}</h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-10 w-10 items-center justify-center rounded-2xl text-[var(--text-muted)] transition-colors hover:bg-black/[0.05] dark:hover:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            ) : null}

            <div className="custom-scrollbar relative z-10 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5 text-[var(--text-secondary)]">
              {children}
            </div>

            {footer ? (
              <div
                className="relative z-10 flex shrink-0 flex-col-reverse gap-3 border-t border-black/[0.06] bg-white/60 px-6 py-4 backdrop-blur-xl dark:border-white/10 dark:bg-black/30 sm:flex-row sm:justify-end"
                style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
              >
                {footer}
              </div>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
