# UI Style Contract

The design system for the Deployment Maintainer dashboard: a **premium, white-first SaaS UI** built with TailwindCSS v4 + DaisyUI v5 and a violet/purple brand. Reuse the tokens and utility classes below; don't invent one-off styles.

Source of truth: [`web/src/index.css`](web/src/index.css) (DaisyUI themes, tokens, surfaces, buttons, inputs, keyframes), [`web/src/components/ui/`](web/src/components/ui/) (GlassCard, Button, Input, Modal, PageHeader, SelectSheet, Meter, Loader, …), [`web/src/components/layout/`](web/src/components/layout/) (AppShell, Sidebar, Navbar), [`web/src/main.jsx`](web/src/main.jsx) (toasts).

> `GlassCard` keeps its historical name but renders the `.surface` family (`mid` → `.surface`, `strong` → `.surface-overlay`, `light` → `.surface-inset`). There is no glassmorphism any more.

---

## 1. Color tokens

### Light mode (DaisyUI theme `light`)

| Token | Hex | Purpose |
|---|---|---|
| `primary` | `#6D28D9` | CTAs, active states, accent borders |
| `primary-content` | `#FFFFFF` | Text on primary bg |
| `secondary` | `#1E1B4B` | Deep indigo, secondary surfaces |
| `accent` | `#6366F1` | Highlights, secondary accents |
| `neutral` | `#0F172A` | Near-black text, icon fills |
| `base-100` | `#FFFFFF` | Main page background |
| `base-200` | `#F8FAFC` | Card/sidebar backgrounds |
| `base-300` | `#F1F5F9` | Inset surfaces, hover states |
| `base-content` | `#0F172A` | Default body text |
| `info` | `#3B82F6` | Info badges/alerts |
| `success` | `#059669` | Success states |
| `warning` | `#D97706` | Warning states |
| `error` | `#DC2626` | Error states |

### Dark mode (DaisyUI theme `dark`)

| Token | Hex | Purpose |
|---|---|---|
| `primary` | `#8B5CF6` | Brighter purple for WCAG contrast |
| `secondary` | `#6366F1` | Indigo |
| `accent` | `#A5B4FC` | Soft lavender |
| `base-100` | `#0F172A` | Main bg — deep navy/slate |
| `base-200` | `#1E293B` | Cards, modals |
| `base-300` | `#334155` | Hover states, dividers |
| `base-content` | `#F8FAFC` | Near-white text |
| `success` | `#34D399` | |
| `warning` | `#FBBF24` | |
| `error` | `#FB7185` | |

Dark mode is switched with the `data-theme` attribute on `<html>` (`light` / `dark`), set by `ThemeContext`. Tailwind's `dark:` variant is remapped to that attribute, not to the OS setting.

### App variables (`:root`, redefined under `:root[data-theme='dark']`)

| Variable | Light | Dark | Purpose |
|---|---|---|---|
| `--premium-ring` | `rgba(55,48,163,0.30)` | `rgba(165,180,252,0.45)` | Focus outline |
| `--premium-border` | `rgba(109,40,217,0.20)` | `rgba(139,92,246,0.28)` | Card / input / divider borders |
| `--premium-shadow` | `0 0 0 1px rgba(15,23,42,.06), 0 2px 8px rgba(15,23,42,.04)` | dark equivalent | Resting elevation |
| `--surface-bg` | `#FFFFFF` | `#1E293B` | `.surface` fill |
| `--surface-inset-bg` | `#F8FAFC` | `#0F172A` | `.surface-inset` fill |
| `--overlay-bg` | `rgba(255,255,255,.9)` | `rgba(30,41,59,.92)` | Modals, nav, dropdowns, toasts, inputs |
| `--brand` / `--brand-soft` | `#6D28D9` / 10% | `#8B5CF6` / 20% | Brand tint used by components (`text-[var(--brand)]`) |
| `--text-primary` / `-secondary` / `-muted` | `#0F172A` / `#334155` / `#64748B` | `#F8FAFC` / `#CBD5E1` / `#94A3B8` | Text |
| `--data-*` | amber, blue, pink, purple, teal | lighter variants | Chart / meter accents |

### Shadow tokens (Tailwind `@theme`)

`shadow-soft` · `shadow-card` · `shadow-lifted` (`0 4px 16px rgba(15,23,42,.10)`).

---

## 2. Typography

- **Sora** — body and headings. **JetBrains Mono** — code, logs, ports, commit hashes (`font-mono`).
- Loaded from Google Fonts at the top of `index.css`:
  `https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap`
- All headings (`h1`–`h6`): `letter-spacing: -0.02em`.
- Hierarchy: page title = bold and dominant → section title = medium-bold → body = regular.
- Table headers: uppercase, ~`0.72rem`, `letter-spacing: 0.02em`, slate-500 (`--text-muted`).

---

## 3. Background

```css
body {
  background-image:
    radial-gradient(circle at 8% 0%,  rgba(30, 27, 75, 0.08),  transparent 38%),
    radial-gradient(circle at 96% 0%, rgba(55, 48, 163, 0.08), transparent 34%),
    linear-gradient(180deg, #ffffff 0%, #f8fafc 52%, #f1f5f9 100%);
}
```

Dark mode:

```css
background-image:
  radial-gradient(circle at 8% 0%,  rgba(139, 92, 246, 0.20), transparent 38%),
  radial-gradient(circle at 96% 0%, rgba(56, 189, 248, 0.12), transparent 34%),
  linear-gradient(180deg, #020617 0%, #0f172a 50%, #1e293b 100%);
```

`AppShell` adds three slow floating orbs (`animate-orb-float-1/2/3`, 18 / 23 / 28 s) as fixed, `pointer-events-none` decoration behind the content.

---

## 4. Surfaces

Use these — never a one-off `div` with ad-hoc shadows. They live in `@layer components`, so Tailwind utilities (`rounded-2xl`, `border-dashed`, …) can still override them.

| Class | Use |
|---|---|
| `.surface` | Cards (opaque fill, `--premium-border`, `--premium-shadow`). Pair with `rounded-2xl`. |
| `.surface-inset` | Inset rows, chips, nested panels (`--surface-inset-bg`). Pair with `rounded-xl`. |
| `.surface-overlay` | Floating layers: sidebar, mobile drawer, modals, dropdowns, toasts (`--overlay-bg`, `blur(6px)`). |
| `.surface-interactive` | Adds a 2px lift + `shadow-lifted` on hover for clickable cards. |

Dividers inside surfaces use `border-[var(--premium-border)]`.

---

## 5. Buttons

All buttons go through [`Button`](web/src/components/ui/Button.jsx).

- `.btn-base`: `border-radius: 0.9rem`, `font-weight: 600`, 44px minimum tap target, spring hover lift (`translateY(-1px)` + soft shadow).
- **`primary` = `.btn-primary-cta`**: animated violet gradient (`#5b21b6 → #6d28d9 → #9333ea → #7c3aed`, `300%` size, `primary-gradient-shift 2.2s linear infinite`, faster on hover, off when `:disabled`), inset top highlight and violet drop shadow. The primary CTA is never a flat fill.
- **`ghost` = `.btn-quiet`**: `--surface-bg` fill, `--premium-border`, `--premium-shadow`; hover → `base-300`.
- **`danger`**: `bg-error text-error-content`.
- Selected/active states (tabs, sidebar item, step chips) use a flat `bg-[var(--brand)] text-white` — they are state indicators, not CTAs.

---

## 6. Inputs / forms

`.field-base` (used by `Input`, `Textarea`, `SelectSheet`): `--premium-border` border, `--overlay-bg` fill, and an indigo focus ring — border `rgba(55,48,163,0.45)` + `0 0 0 3px rgba(55,48,163,0.12)` in light, lavender equivalents in dark. Never the browser default ring.

Global `:focus-visible { outline: 2px solid var(--premium-ring); outline-offset: 2px; }`.

On viewports under 768px, form controls are forced to 16px to stop iOS zoom.

---

## 7. Transitions

```css
.ui-transition {
  transition-property: color, background-color, border-color, opacity, box-shadow, transform;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
```

- Standard easing: `cubic-bezier(0.22, 1, 0.36, 1)` (snappy spring).
- Exit easing: `cubic-bezier(0.55, 0, 1, 0.45)`.

---

## 8. Animation utilities

Keyframes and classes are defined in `index.css`.

| Class | Behavior | Duration |
|---|---|---|
| `.animate-fade-in` | Opacity 0→1 | 380ms ease-out |
| `.animate-fade-in-up` | Fade + rise 18px | 480ms spring |
| `.animate-fade-in-up-1` … `-4` | Same, staggered delay 0 / 60 / 120 / 180ms | 480ms |
| `.animate-slide-in-left` | Slide from left | 520ms spring |
| `.animate-scale-in` | Scale 0.95→1 + rise | 220ms spring |
| `.animate-dropdown-in` | Dropdown open | 180ms spring |
| `.animate-row-in` | Table row enter | 320ms spring |
| `.animate-modal-in` | Modal open (scale 0.9 + rise) | 360ms spring |
| `.animate-modal-shimmer` | Shimmer sweep on modal open | 900ms, 200ms delay |
| `.drawer-panel-enter-left` / `-exit-left` | Drawer slide | 280ms spring / 220ms fast-out |
| `.drawer-backdrop-enter` / `-exit` | Backdrop fade | 250ms / 210ms |
| `.animate-orb-float-1/2/3` | Slow background orbs | 18s / 23s (−4s) / 28s (−8s) |
| `.animate-shimmer` | Skeleton loading sweep | 1.8s loop |
| `.animate-blobsq-morph` | Morphing blob shape | 3s loop |
| `.app-surface-header` | Animated violet header accent (`PageHeader`) | 8s loop |

Other keyframes available: `blueprint-pulse`, `loader-orb-pulse`, `primary-gradient-shift`, `sheet-up`.

Modals and drawers that use `framer-motion` (`Modal`, mobile nav drawer, `GlassCard`) drive their own entry motion with spring transitions — don't stack a CSS entry animation on top.

Rules: motion is calm, purposeful and short. List entries stagger in 60ms steps. Modals open with scale + rise; drawers slide from the edge.

---

## 9. Scrollbar

Thin slate scrollbars everywhere: `scrollbar-width: thin`, 10px WebKit bars, pill-shaped track, slate gradient thumb that darkens on hover; the dark theme swaps in a lighter thumb and navy track.

---

## 10. Page header

[`PageHeader`](web/src/components/ui/PageHeader.jsx): a `.surface` card whose background is `.app-surface-header` — a white → 10% violet → white gradient (`220%` size) drifting over 8s. It carries a 4px primary stripe on the left, a brand-soft icon badge, an uppercase eyebrow pill, a bold `h1` and an actions slot.

---

## 11. Accessibility

```css
@media (prefers-reduced-motion: reduce) {
  .animate-blueprint-pulse, .animate-loader-orb-pulse, .animate-blobsq-morph,
  .animate-orb-float-1, .animate-orb-float-2, .animate-orb-float-3,
  .animate-shimmer, .animate-modal-shimmer, .btn-primary-cta, .app-surface-header {
    animation: none !important;
  }
}
```

Keep every new looping animation in this list. Minimum tap target is 44px; text on `primary` is always white.

---

## 12. Rules summary

1. **White-first.** Dark surfaces only in dark mode.
2. **Primary = `#6D28D9` light / `#8B5CF6` dark.** No other brand color.
3. **All buttons** use `border-radius: 0.9rem`, `font-weight: 600`, spring hover lift.
4. **Primary CTA** = animated gradient, never a flat fill.
5. **Inputs** focus with the indigo ring, not the browser default.
6. **Cards** = `.surface` / `.surface-inset` / `.surface-overlay` — never ad-hoc shadows.
7. **Entry animations** = `fade-in-up`, staggered in 60ms steps for lists.
8. **Modals** scale + rise; **drawers** slide from the edge.
9. **Orbs** float slowly (18–28s), decoration only, never interactive.
10. **No heavy animation.** Calm, purposeful, short.
11. **Reduced-motion** media query must cover every loader, orb and blob.
12. **Font**: Sora always; JetBrains Mono for code/mono contexts only.
13. **Scrollbar** styled thin with a slate gradient thumb.
14. **Dark mode** via `data-theme` on `<html>`, not an OS class.
