# Glassmorphism Styling Reference

The design system for the Deployment Maintainer dashboard: surfaces, blur, borders, highlights, shadows, radii, typography, motion and dark mode. Wherever a component uses the primary color it's called the "brand tint" (see §8a).

Source of truth: [`web/src/index.css`](web/src/index.css) (tokens + utilities), [`web/src/components/ui/`](web/src/components/ui/) (GlassCard, Button, Modal, PageHeader, SelectSheet, Meter, Loader, …), [`web/src/components/layout/`](web/src/components/layout/), [`web/src/main.jsx`](web/src/main.jsx) (toasts).

---

## 1. The three-layer depth model

| Layer              | What it is          | How it's built                                                                                                 |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **1 · Atmosphere** | The page background | Two radial "light" blooms over a diagonal linear gradient, `background-attachment: fixed`                      |
| **2 · Diffusion**  | What glass blurs    | `backdrop-filter: blur()` on every surface (10 / 16 / 20px utilities; Tailwind `blur-sm`…`blur-2xl` on chrome) |
| **3 · Surface**    | The glass panels    | Translucent white fill + 1px translucent border + **inset top highlight** + soft drop shadow                   |

The glass only reads as glass because layer 1 is never flat — there's always something behind the panel to diffuse.

---

## 2. Atmosphere — page background

Defined once as `--page-bg` and applied to `body`:

```css
/* Light */
--page-bg:
  radial-gradient(ellipse 70% 60% at 80% 10%, rgba(180, 210, 185, 0.55) 0%, transparent 60%),
  /* key light, top-right  */
  radial-gradient(ellipse 50% 70% at 15% 85%, rgba(210, 195, 170, 0.4) 0%, transparent 55%),
  /* fill light, bottom-left */ linear-gradient(160deg, #f5f0e8 0%, #e8ede3 45%, #dce8dc 100%); /* cream → sage */

body {
  background: var(--page-bg);
  background-attachment: fixed; /* glass blurs a stable field while content scrolls */
  transition:
    background 0.3s ease,
    color 0.3s ease;
}
```

- **Light mode:** warm cream `#F5F0E8` → sage `#E8EDE3` → `#DCE8DC`, sage bloom top-right, sand bloom bottom-left.
- **Dark mode:** deep forest near-blacks `#0B140F` → `#101B14` → `#142219`, with the same two bloom positions reduced to a faint brand-tinted glow (12% and 8% opacity).

Background atmosphere tokens:

| Token             | Light     | Dark      |
| ----------------- | --------- | --------- |
| `--bg-cream`      | `#F5F0E8` | `#0B140F` |
| `--bg-sage-light` | `#E8F0E9` | `#101B14` |
| `--bg-sage`       | `#DCEBDD` | `#142219` |

---

## 3. Glass surface tokens

| Token               | Light                    | Dark                      | Used for                                     |
| ------------------- | ------------------------ | ------------------------- | -------------------------------------------- |
| `--glass-strong-bg` | `rgba(255,255,255,0.86)` | `rgba(255,255,255,0.08)`  | Nav, drawers, hero cards, toasts             |
| `--glass-mid-bg`    | `rgba(255,255,255,0.74)` | `rgba(255,255,255,0.05)`  | Default cards, mobile top bar, ghost buttons |
| `--glass-light-bg`  | `rgba(255,255,255,0.60)` | `rgba(255,255,255,0.035)` | Nested/secondary elements, small controls    |
| `--glass-border`    | `rgba(255,255,255,0.85)` | `rgba(255,255,255,0.12)`  | 1px border on all glass                      |
| `--glass-highlight` | `#FFFFFF`                | `rgba(255,255,255,0.2)`   | Inset top-edge light catch                   |

Note the inversion: light mode is a _mostly opaque_ white film (60–86%) for legibility; dark mode is a _barely there_ white film (3.5–8%) so panels lift off the dark field without going grey.

---

## 4. Glass utility classes

All in `web/src/index.css`. Every tier has the same four ingredients: **fill, blur, border, inset highlight + shadow**.

```css
.glass-strong {
  /* hero cards, nav, drawers */
  background: var(--glass-strong-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    /* top rim catches light */ inset 0 -1px 0 rgba(255, 255, 255, 0.05),
    /* faint bottom rim */ 0 8px 32px rgba(0, 0, 0, 0.06),
    0 2px 8px rgba(0, 0, 0, 0.04);
}

.glass-mid {
  /* default cards, stat panels */
  background: var(--glass-mid-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    0 8px 24px rgba(0, 0, 0, 0.05);
}

.glass-light {
  /* nested / secondary elements */
  background: var(--glass-light-bg);
  backdrop-filter: blur(10px);
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    0 4px 12px rgba(0, 0, 0, 0.04);
}

.glass-card {
  /* mid-tier with warm-tinted shadow */
  background: var(--glass-mid-bg);
  backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    0 8px 24px rgba(22, 40, 26, 0.05),
    0 2px 6px rgba(22, 40, 26, 0.03);
}

.glass-nav {
  /* pill navigation */
  background: var(--glass-strong-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    0 8px 24px rgba(22, 40, 26, 0.06);
}

.glass-interactive {
  /* lift on hover */
  transition:
    transform 180ms cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 180ms cubic-bezier(0.4, 0, 0.2, 1);
}
.glass-interactive:hover {
  transform: translateY(-2px);
}
```

**Key details**

- **The inset top highlight** (`inset 0 1px 0 var(--glass-highlight)`) is what makes a translucent box look like a slab of glass with thickness. Every glass surface and ghost button has it.
- **Blur scales with tier:** 20px → 16px → 10px. Stronger panels blur more; nested panels blur less, so glass-on-glass doesn't turn to fog.
- **Shadows are low-opacity and large-radius** (4–6%, 12–32px spread). The `glass-card` / `glass-nav` shadows use the warm near-black `rgba(22,40,26,…)` instead of pure black so they sit naturally on the cream/sage field.
- Always ship `-webkit-backdrop-filter` alongside `backdrop-filter` (Safari/iOS).

### Blur scale in use

| Source                        | Value | Where                                                                                    |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| `.glass-light`                | 10px  | Small controls, nested cards                                                             |
| `.btn-ghost`                  | 12px  | Ghost buttons                                                                            |
| `.glass-mid`, toasts          | 16px  | Cards, toasts                                                                            |
| `.glass-strong`, `.glass-nav` | 20px  | Hero cards, nav                                                                          |
| Tailwind `backdrop-blur-sm`   | 8px   | Modal / drawer scrim                                                                     |
| Tailwind `backdrop-blur-md`   | 12px  | Modal header strip                                                                       |
| Tailwind `backdrop-blur-xl`   | 24px  | Page header, modal footer                                                                |
| Tailwind `backdrop-blur-2xl`  | 40px  | Modal sheet, bottom nav, mobile top bar, sidebar drawer (fixed chrome over busy content) |

---

## 5. `GlassCard` component

[`GlassCard.jsx`](web/src/components/ui/GlassCard.jsx) wraps the utilities with radius, padding and motion:

| `variant`       | Class          | Radius               |
| --------------- | -------------- | -------------------- |
| `strong`        | `glass-strong` | `rounded-3xl` (24px) |
| `mid` (default) | `glass-mid`    | `rounded-3xl` (24px) |
| `light`         | `glass-light`  | `rounded-2xl` (16px) |

- Padding: `p-5 sm:p-6`
- Enter: `opacity 0, y 8 → opacity 1, y 0` over `0.25s easeOut`
- `interactive`: hover lifts `y: -2` (0.15s), tap `scale: 0.99`, `cursor-pointer`
- `transition-colors duration-200` so theme switches fade rather than snap

---

## 6. Corner radius scale

Glass never has sharp corners.

| Element                                                                      | Radius             |
| ---------------------------------------------------------------------------- | ------------------ |
| Modal sheet (mobile)                                                         | `28px` top corners |
| Large cards, modal (desktop), page header (sm+)                              | `rounded-3xl` 24px |
| Light cards, inputs, selects, md/lg buttons, nav links, page header (mobile) | `rounded-2xl` 16px |
| Toasts                                                                       | 16px               |
| `.btn-base` default                                                          | 14px               |
| Small buttons, icon buttons, logo tile, list options                         | `rounded-xl` 12px  |
| Pills, chips, badges, bottom nav, FAB, avatars dots                          | `rounded-full`     |

---

## 7. Text colors

Warm near-blacks — never `#000` on light, never `#fff` on dark.

| Token              | Light     | Dark      | Use                                       |
| ------------------ | --------- | --------- | ----------------------------------------- |
| `--text-primary`   | `#16281A` | `#E9F3EA` | Headings, values, main copy               |
| `--text-secondary` | `#3A4F3D` | `#B6C9B8` | Body, modal content, subtitles            |
| `--text-muted`     | `#7A8C7C` | `#7E9481` | Labels, inactive nav, placeholders, icons |

Dividers and hairlines: `border-black/[0.06]` or `bg-black/5` in light, `border-white/10` or `bg-white/5` in dark.

---

## 8. Supporting data colors

Used for charts, tags and category dots (not for chrome).

| Token           | Light     | Dark      |
| --------------- | --------- | --------- |
| `--data-amber`  | `#F59E0B` | `#FBBF24` |
| `--data-blue`   | `#3B82F6` | `#60A5FA` |
| `--data-pink`   | `#E879F9` | `#F472B6` |
| `--data-purple` | `#8B5CF6` | `#A78BFA` |
| `--data-teal`   | `#14B8A6` | `#2DD4BF` |


Status colors: warning/offline uses amber (`bg-amber-500/10`, `border-amber-500/20`, `text-amber-700 / dark:text-amber-400`); destructive uses rose (`bg-rose-500/90`, hover `rose-600`, `shadow-rose-500/20`); toast error icon `#EF4444`.

---

## 8a. Brand tint

| Token          | Light                   | Dark                     | Use                                                     |
| -------------- | ----------------------- | ------------------------ | ------------------------------------------------------- |
| `--brand`      | `#2F7D52`               | `#5FBF86`                | Primary button, active nav, focus rings, wordmark, commands in logs |
| `--brand-soft` | `rgba(47,125,82,0.14)`  | `rgba(95,191,134,0.18)`  | Ambient orbs, subtle fills                              |

Primary buttons use white text in light mode and `#0B140F` text in dark mode for contrast.

**Status mapping** (pills per §15): deploying/running/queued = brand + pulse · online/success/healthy = teal · stopped/cancelled = amber · failed/errored/unhealthy = rose · anything else = neutral.

---

## 9. Typography

| Role                                                       | Font                               | Details                       |
| ---------------------------------------------------------- | ---------------------------------- | ----------------------------- |
| Headings (`h1–h4`, `.font-heading`, `.font-serif-display`) | **Poppins** (`--font-poppins`)     | `letter-spacing: -0.02em`     |
| Body                                                       | **Open Sans** (`--font-open-sans`) | Falls back to system UI stack |

Recurring type patterns:

- **Page title:** `text-2xl sm:text-3xl lg:text-4xl font-medium tracking-tight leading-tight`
- **Modal title:** `text-xl sm:text-2xl font-bold tracking-tight`
- **Eyebrow pill:** `text-[10px] font-bold uppercase tracking-[0.12em] px-2.5 py-1 rounded-full` with a 6px pulsing dot
- **Ring center value:** `text-3xl sm:text-4xl font-medium tracking-tight`
- **Micro label:** `text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]`
- **Bottom-nav label:** `text-[10px]`
- **Wordmark:** "Deploy" in `--text-primary` + "Maintainer" in a lighter weight / brand tint

`html` gets `antialiased`.

---

## 10. Buttons (non-primary variants)

Base (`.btn-base`):

```css
min-height: 44px;
min-width: 44px; /* touch target */
border-radius: 14px;
font-weight: 500;
font-size: 0.9375rem;
transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
```

**Ghost (glass button):**

```css
.btn-ghost {
  background: var(--glass-mid-bg);
  color: var(--text-primary);
  border: 1px solid var(--glass-border);
  backdrop-filter: blur(12px);
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
.btn-ghost:hover:not(:disabled) {
  transform: translateY(-2px);
  background: var(--glass-strong-bg); /* hover = step up one glass tier */
}
```

**Danger:** `bg-rose-500/90 text-white hover:bg-rose-600 shadow-md shadow-rose-500/20`.

Sizes (from `Button.jsx`):

| Size   | Classes                                                     |
| ------ | ----------------------------------------------------------- |
| `sm`   | `min-h-[44px] px-3.5 py-1.5 text-sm rounded-xl`             |
| `md`   | `min-h-[44px] px-5 py-2.5 text-sm sm:text-base rounded-2xl` |
| `lg`   | `min-h-[48px] px-6 py-3 text-base rounded-2xl`              |
| `icon` | `min-h-[44px] min-w-[44px] p-2.5 rounded-xl`                |

All buttons: `active:scale-[0.98]`, `disabled:opacity-50 disabled:pointer-events-none`, 2px focus-visible ring at 50% opacity, spinner (`Loader2 animate-spin`) replaces the icon while loading.

Small glass icon controls (hamburger, theme toggle): `min-h-[38px] min-w-[38px] rounded-xl glass-light border border-white/60 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 shadow-xs`.

---

## 11. Navigation chrome

### Mobile top bar ([`Navbar.jsx`](web/src/components/layout/Navbar.jsx))

`sticky top-0 z-30 glass-mid backdrop-blur-2xl border-b border-white/60 dark:border-white/10 shadow-sm px-4 py-2.5` — hidden on `lg+`.

### Floating pill bottom nav (not used here)

This dashboard has six destinations, so mobile uses the top bar + drawer instead of a bottom nav. If one is added later: `fixed bottom-3 left-3 right-3`, `glass-strong backdrop-blur-2xl rounded-full` pill with `pb-[env(safe-area-inset-bottom)]`, 44px items, floating over content rather than edge to edge.

### Sidebar ([`Sidebar.jsx`](web/src/components/layout/Sidebar.jsx))

Fixed `glass-strong` panel on `lg+`; below `lg` the same content opens as the drawer described here.

- Scrim: `fixed inset-0 bg-black/60 backdrop-blur-sm`
- Panel: `w-72 max-w-[85vw] glass-strong backdrop-blur-2xl border-r border-white/60 dark:border-white/10 shadow-2xl p-6`, slides with `transition-transform duration-300 ease-in-out`
- Nav links: `px-4 py-3 rounded-2xl text-sm font-medium`, 200ms transitions
- Footer cards (theme toggle, user card): `glass-light rounded-2xl border border-white/60 dark:border-white/10 shadow-xs`
- Logout hover: `hover:text-rose-500 hover:bg-rose-500/10`

---

## 12. Page header ([`PageHeader.jsx`](web/src/components/ui/PageHeader.jsx))

A layered glass card rather than a utility class:

```
┌ rounded-2xl sm:rounded-3xl · overflow-hidden · border-white/70 (dark: white/[0.08]) · shadow-sm
│  ├ absolute glass fill:  bg-white/60 dark:bg-white/[0.04] backdrop-blur-xl
│  ├ ambient orb top-right:    w-48 h-48, -top-12 -right-12, rounded-full blur-3xl, 15–20% brand tint
│  ├ ambient orb bottom-left:  w-40 h-40, -bottom-10 -left-10, rounded-full blur-3xl, 10–15% tint
│  ├ left stripe: 4px wide, inset top-4/bottom-4, rounded-full, vertical gradient, 80% opacity
│  └ content (z-10): px-6 sm:px-8 py-5 sm:py-6, icon badge 44px rounded-2xl, eyebrow pill, h1, actions slot
```

The orbs are static and clipped by `overflow-hidden`, so they only color the glass from inside — they never float over the page.

---

## 13. Modals / bottom sheets ([`Modal.jsx`](web/src/components/ui/Modal.jsx))

Rendered in a portal on `document.body`, `z-[9999]`.

- **Scrim:** `bg-black/40 dark:bg-black/60 backdrop-blur-sm`, fades in 0.2s
- **Sheet surface:**
  - Light: vertical gradient `white/95 → #F8FAF8/92 → #EEF5EF/95`
  - Dark: `#112017/95 → #0E1A13/95 → #0A140F/95`
  - `backdrop-blur-2xl`, `border border-white/80`
  - `rounded-t-[28px]` on mobile (bottom sheet), `sm:rounded-3xl` centered dialog on desktop
  - Shadow: `0 25px 60px -15px rgba(20,50,30,0.2)` plus a soft outer glow
  - `max-h-[90dvh]` mobile / `sm:max-h-[85vh]` desktop
- **Ambient orbs:** two `w-56 h-56 blur-3xl` circles at top-right and bottom-left corners, clipped inside
- **Drag handle (mobile only):** `w-12 h-1.5 rounded-full bg-neutral-300/80 dark:bg-neutral-600/60`
- **Header strip:** `bg-white/40 dark:bg-white/[0.02] backdrop-blur-md border-b border-black/[0.06] dark:border-white/10`
- **Body:** internally scrolling, `overscroll-contain`, `text-[var(--text-secondary)] space-y-4`
- **Sticky footer:** `bg-white/60 dark:bg-black/30 backdrop-blur-xl border-t`, bottom padding includes `env(safe-area-inset-bottom)`; buttons stack reversed on mobile, row-right-aligned on desktop
- **Close button:** 40px, `rounded-2xl`, `hover:bg-black/[0.05] dark:hover:bg-white/10`

Motion: spring `damping: 30, stiffness: 320`, enters from `y: 100%, scale 0.98, opacity 0.8`. Drag-to-dismiss on the y axis (`dragElastic` bottom 0.4) closes past 100px offset or 400px/s velocity.

CSS fallbacks also exist: `.animate-sheet-up` (0.26s, `cubic-bezier(0.16, 1, 0.3, 1)`, from `translateY(100%)`) and `.animate-modal-in` (0.2s, from `scale(0.96)` + opacity 0).

---

## 14. Form controls

Inputs are "frosted wells" — slightly more opaque than surrounding glass so text stays crisp.

```
/* Auth / icon-prefixed input */
bg-white/50 dark:bg-black/40 border border-white/60 dark:border-white/10
rounded-2xl pl-10 pr-4 py-3 outline-none focus:ring-2

/* Modal form field */
bg-white/80 dark:bg-black/25 border border-black/[0.08] dark:border-white/10
rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 shadow-xs transition-all
focus:bg-white dark:focus:bg-black/40 focus:ring-3
placeholder:text-[var(--text-muted)]/50
```

**Select sheet trigger** ([`SelectSheet.jsx`](web/src/components/ui/SelectSheet.jsx)): `bg-white/60 dark:bg-black/40 border border-white/60 dark:border-white/10 rounded-2xl px-4 py-2.5 shadow-xs hover:bg-white/80 dark:hover:bg-black/60`, with a custom CSS-triangle up/down caret in `--text-muted`. Options open in the glass bottom sheet as `rounded-xl` rows.

Pattern: light mode inputs are **whiter** than the card; dark mode inputs are **darker** than the card (`black/25–40`). Focus makes them more solid.

---

## 15. Chips, pills and badges

- **Neutral status chip** (sync badge): `rounded-full px-2.5 py-1 text-xs font-medium bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 shadow-xs`, `text-[11px]` label, 12px icon
- **Tinted status pill:** `rounded-full px-3 py-1 text-xs font-medium bg-{color}-500/10 border border-{color}-500/20` — tint fill at 10%, border at 20%
- Live states use `animate-pulse`; a 6–8px dot precedes the label

---

## 16. Toasts ([`main.jsx`](web/src/main.jsx))

`react-hot-toast`, `position: bottom-center`, styled as a glass-strong chip:

```js
background: 'var(--glass-strong-bg)',
backdropFilter: 'blur(16px)',
border: '1px solid var(--glass-border)',
boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
borderRadius: '16px',
fontWeight: 500,
color: 'var(--text-primary)',
```

Icon secondary color is `--glass-strong-bg` so the check/cross glyph reads as cut out of the glass.

---

## 17. Animated ring & loader

**Ring** ([`Meter.jsx`](web/src/components/ui/Meter.jsx), exported alongside the bar meter; color by threshold: teal < 70%, amber 70–90%, rose > 90%):

- SVG rotated `-90deg` so the arc starts at 12 o'clock
- Track: `text-black/[0.07] dark:text-white/[0.08]`
- Arc: `stroke-linecap: round`, `stroke-dasharray = circumference`
- Draw-in: `stroke-dashoffset` animates from full to target over `1.2s cubic-bezier(0.4, 0, 0.2, 1)`, starting 150ms after mount
- Defaults: 180px size, 10px stroke; value clamped 0–100 for the arc

**Loader** ([`Loader.jsx`](web/src/components/ui/Loader.jsx)): blurred radial halo (`blur-2xl`) behind concentric faint rings (10–20% opacity), spinning arcs, a glowing center dot, wordmark, and three bouncing 4px dots.

---

## 18. Motion rules

| Interaction         | Spec                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| Card enter          | fade + `y: 8 → 0`, 0.25s easeOut                                           |
| Card / button hover | `translateY(-2px)`, 150–180ms `cubic-bezier(0.4, 0, 0.2, 1)`               |
| Press               | `scale(0.98–0.99)`; icon buttons / FAB `scale(0.95)`                       |
| Modal               | spring (damping 30, stiffness 320); scrim fade 0.2s                        |
| Drawer              | `transform` 300ms ease-in-out                                              |
| Theme switch        | `background`/`color` 0.3s ease on body; `transition-colors 200ms` on cards |
| Data reveal         | ring stroke 1.2s                                                           |

Cards lift with `translateY`, never `scale` on hover — scaling glass causes blurry re-rasterization and layout jitter.

---

## 19. Scrollbars

```css
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(122, 140, 124, 0.25);
  border-radius: 9999px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(122, 140, 124, 0.45);
}

.custom-scrollbar {
  /* opt-in for scroll areas inside cards */
  scrollbar-width: thin;
  scrollbar-color: rgba(122, 140, 124, 0.25) transparent;
}
```

Thumb uses the muted sage text color at low opacity so it disappears into the glass.

---

## 20. Dark mode mechanics

- Toggled by `data-theme="dark"` (or `.dark`) on a root element; Tailwind's `dark:` variant is remapped:
  ```css
  @custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *, .dark, .dark *));
  ```
- All glass, text, background and data tokens are redefined under `[data-theme="dark"], .dark` — components mostly just consume variables.
- Where Tailwind literals are used, each light value has a paired `dark:` value. Common pairs:

| Light                            | Dark                             |
| -------------------------------- | -------------------------------- |
| `border-white/60–80`             | `border-white/10` (or `/[0.08]`) |
| `bg-white/40–60`                 | `bg-white/[0.02–0.04]`           |
| `bg-white/50–80` (inputs)        | `bg-black/25–40`                 |
| `bg-black/5` (chips, hovers)     | `bg-white/5–10`                  |
| `border-black/[0.06]` (dividers) | `border-white/10`                |
| `bg-black/40` (scrim)            | `bg-black/60`                    |

---

## 21. Mobile & iOS polish

- **44px minimum touch targets** on all buttons and nav items (38–40px only for compact header icons)
- Inputs forced to `16px` under 768px to prevent iOS Safari auto-zoom
- Date/time inputs reset with `appearance: none`, `min-width: 0` to stop native overflow
- `env(safe-area-inset-bottom)` on bottom nav and modal footer; `viewportFit: cover`
- `dvh` units for sheet height; modal re-sizes around the on-screen keyboard
- `html, body { overflow-x: hidden; max-width: 100vw }` and `min-w-0` / `max-w-full` throughout to prevent horizontal scroll
- `box-sizing: border-box` on everything

---

## 22. Checklist for a new glass surface

1. Pick a tier: `glass-strong` (top-level/chrome), `glass-mid` (default), `glass-light` (nested).
2. Radius from the scale in §6 — never 0.
3. Keep the inset top highlight (it comes with the utility; add `inset 0 1px 0 var(--glass-highlight)` if hand-rolling).
4. Nesting: go _down_ a tier (strong → mid → light), never stack two 20px blurs.
5. Provide a `dark:` pair for any Tailwind literal `white/…` or `black/…`.
6. Use `--text-primary / --text-secondary / --text-muted`, not raw hex.
7. Hover = `translateY(-2px)`; press = `scale(0.98)`.
8. Include `-webkit-backdrop-filter` when writing raw CSS.
