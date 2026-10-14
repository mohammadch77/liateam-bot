/**
 * Avina design tokens — the single source of truth.
 * Every value is taken from the Avina design export (contract/designs/d1v2): "Style Sheet.dc.html" for the
 * named palette, type scale, spacing, radii, shadows, motion and breakpoints; ProductCard / SiteHeader /
 * SiteFooter for the component-level values listed under `color.ext`. Nothing here is invented.
 *
 * CSS custom properties are generated from this object (see cssVariables) and injected once in the root layout,
 * so CSS and TypeScript can never disagree. Use `v('primary')` in TS, `var(--color-primary)` in CSS.
 */

export const color = {
  // ── Style sheet palette (token name = the design's own token) ──
  ink: '#1E1B24', // primary text, footer · 16.4:1
  'ink-2': '#4A4450', // secondary text · 9.2:1
  muted: '#6E6873', // metadata · 5.4:1
  surface: '#FCFBFA', // page background
  'surface-2': '#F4F0EE', // search field, tabs
  blush: '#F8EEF0', // sections, hover
  primary: '#8A1C4A', // berry 700 — CTA, discount · 9.0:1
  'primary-hover': '#741540', // berry 800
  'primary-press': '#5E1034', // berry 900
  accent: '#C9937A', // rose gold — decorative only (underline, star, ring) · 2.6:1
  'accent-text': '#9A6550', // dark rose gold — brand names · 4.8:1
  line: '#EEE7E4', // card border
  success: '#1F7A4D', // in stock · 5.3:1
  'success-50': '#E6F3EC',
  warning: '#8A4B00', // limited stock · 6.9:1
  'warning-50': '#FBF0DE',
  danger: '#B42318', // form error · 6.5:1
  'danger-50': '#FCE9E7',

  // ── Component-level values used in the design files ──
  white: '#FFFFFF',
  backdrop: '#E7E2DF', // canvas behind the frames
  'blush-2': '#F4E3EA', // chips, pressed ghost, card add button
  'line-strong': '#E1D9D6', // input / select border
  'line-pill': '#EAE2DF', // wallet pill, recent-search chips
  'line-soft': '#F0EAE7', // nav and mega-menu dividers
  'line-row': '#F2ECEA', // table / list row divider
  'line-button': '#DDD5D2', // white link buttons
  'line-card-hover': '#E4D7D3',
  'checkbox-border': '#CFC6C3',
  'disabled-bg': '#EDE7E5',
  'disabled-field': '#F6F3F1',
  'disabled-text': '#8C858F',
  'danger-field': '#FFFBFA',
  'danger-line': '#F3D3CF',
  'danger-ink': '#8E1C12',
  'warning-ink': '#6B3A00',
  'warning-dot': '#C77700',
  'warning-line': '#F0DCB8',
  'success-on-dark': '#6FD39C',
  'link-on-dark': '#F0C7B6',
  'promo-ink': '#6B1538', // mobile promo strip text on blush
  'skeleton-a': '#F3EFED',
  'skeleton-b': '#F9F6F5',
  'skeleton-block': '#F1ECEA',
  'pedestal-a': '#F8EEED',
  'pedestal-b': '#EBD9D7',
  'stage-mid': '#FAF4F3',
  'stage-edge': '#F3E7E6',
  // footer (dark)
  'dark-text': '#D9D3DC',
  'dark-muted': '#BDB5C1',
  'dark-faint': '#A8A1AD',
  'dark-field': '#28242F',
  'dark-line': '#3A3542',
  'dark-rule': '#322D39',
  'dark-icon': '#E2B9A6',
  'topbar-text': '#EDE6EA',
} as const;

export type ColorToken = keyof typeof color;

/** Style sheet "مقیاس تایپوگرافی". size px / line-height / weight / letter-spacing px. */
export const type = {
  display: { size: 50, line: 1.4, weight: 800, tracking: -0.8, label: 'نمایشی' },
  h1: { size: 32, line: 1.45, weight: 800, tracking: -0.5, label: 'تیتر ۱' },
  section: { size: 26, line: 1.5, weight: 800, tracking: 0, label: 'تیتر بخش (صفحه اصلی)' },
  h2: { size: 24, line: 1.5, weight: 800, tracking: -0.2, label: 'تیتر ۲' },
  h3: { size: 18, line: 1.6, weight: 700, tracking: 0, label: 'تیتر ۳' },
  'body-lg': { size: 16, line: 2.05, weight: 400, tracking: 0, label: 'متن بزرگ' },
  body: { size: 14.5, line: 1.95, weight: 400, tracking: 0, label: 'متن' },
  small: { size: 13, line: 1.8, weight: 500, tracking: 0, label: 'کوچک' },
  caption: { size: 12, line: 1.7, weight: 600, tracking: 0, label: 'زیرنویس' },
  price: { size: 24, line: 1.3, weight: 800, tracking: 0, label: 'قیمت (tnum، «تومان» ۱۲)' },
} as const;

export type TypeToken = keyof typeof type;

/** Base-4 spacing scale from the style sheet. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 14: 56, 18: 72 } as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
  // component radii from the design files
  field: 12, // inputs, select, small buttons
  button: 13, // 48 / 52 px buttons
  panel: 24, // style sheet sections
} as const;

export const shadow = {
  sm: '0 1px 2px rgba(30,27,36,.08)',
  md: '0 20px 40px -22px rgba(30,27,36,.35)', // card hover
  lg: '0 30px 60px -24px rgba(30,27,36,.35)', // menus, dropdowns
  brand: '0 14px 26px -12px rgba(138,28,74,.7)', // CTA
  toast: '0 14px 30px -14px rgba(30,27,36,.5)',
  'focus-field': '0 0 0 4px rgba(138,28,74,.12)',
} as const;

export const motion = {
  fast: '150ms', // hover, press, tick
  base: '220ms', // card, tab, accordion
  slow: '300ms', // mega menu, bottom sheet
  ease: 'cubic-bezier(.2,.7,.2,1)',
} as const;

/** Control heights: 52 main CTA · 48 default · 44 minimum touch target. */
export const control = { lg: 52, md: 48, sm: 44 } as const;

/**
 * Style sheet "نقاط شکست و شبکه". CSS media queries cannot read custom properties, so module CSS repeats these
 * numbers (min-width 768 / 1024 / 1440); keep them in sync with this table.
 */
export const breakpoints = {
  mobile: { min: 0, columns: 2, gutter: 16 }, // 360+: 2 columns, bottom navigation
  tablet: { min: 768, columns: 3, gutter: 24 }, // filters in a bottom sheet
  laptop: { min: 1024, columns: 4, gutter: 32 }, // side filters
  desktop: { min: 1440, columns: 5, gutter: 60 }, // container 1320
} as const;

export const container = { max: 1440, content: 1320 } as const;

export const font = {
  family: 'var(--font-vazirmatn), Vazirmatn, Tahoma, sans-serif',
  weights: [300, 400, 500, 600, 700, 800, 900],
} as const;

/** `v('primary')` → 'var(--color-primary)' for inline styles in TS. */
export const v = (token: ColorToken) => `var(--color-${token})` as const;

/** All tokens as CSS custom properties (injected once in the root layout). */
export function cssVariables(): string {
  const lines: string[] = [];
  for (const [k, val] of Object.entries(color)) lines.push(`--color-${k}:${val}`);
  for (const [k, t] of Object.entries(type)) {
    lines.push(
      `--type-${k}-size:${t.size}px`,
      `--type-${k}-line:${t.line}`,
      `--type-${k}-weight:${t.weight}`,
    );
    lines.push(`--type-${k}-tracking:${t.tracking}px`);
  }
  for (const [k, val] of Object.entries(space)) lines.push(`--space-${k}:${val}px`);
  for (const [k, val] of Object.entries(radius)) lines.push(`--radius-${k}:${val}px`);
  for (const [k, val] of Object.entries(shadow)) lines.push(`--shadow-${k}:${val}`);
  for (const [k, val] of Object.entries(motion)) lines.push(`--motion-${k}:${val}`);
  for (const [k, val] of Object.entries(control)) lines.push(`--control-${k}:${val}px`);
  lines.push(`--container-max:${container.max}px`, `--container-content:${container.content}px`);
  lines.push(`--font-sans:${font.family}`);
  return `:root{${lines.join(';')}}`;
}
