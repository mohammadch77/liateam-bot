import type { CSSProperties } from 'react';
import { ICON_PATHS, ICON_PATHS_FILLED, type IconName } from './paths';

export type { IconName };

type Props = {
  name: IconName;
  /** px; the design uses 15–25 */
  size?: number;
  /** filled variant where the design uses FILL 1 (active tab, favourite, star) */
  filled?: boolean;
  /** accessible name; without it the icon is decorative and hidden from screen readers */
  label?: string;
  className?: string;
  style?: CSSProperties;
};

/** Material Symbols Outlined glyph as inline SVG; inherits `color`. */
export function Icon({ name, size = 20, filled = false, label, className, style }: Props) {
  const d = (filled && ICON_PATHS_FILLED[name]) || ICON_PATHS[name];
  return (
    <svg
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      style={{ flex: 'none', ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}
