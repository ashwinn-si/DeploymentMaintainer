import { useEffect, useRef } from 'react';

// Fades and lifts its child into view once. One observer per element, so content mounted later still reveals.
export function Reveal({ as: Tag = 'div', delay = 0, className = '', children, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('visible');
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add('visible');
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag ref={ref} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}s` } : undefined} {...rest}>
      {children}
    </Tag>
  );
}
