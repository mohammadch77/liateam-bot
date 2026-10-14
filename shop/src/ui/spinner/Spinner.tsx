import { Icon } from '../icon/Icon';

/** Rotating progress_activity glyph used by loading buttons in the design. */
export function Spinner({ size = 20, label }: { size?: number; label?: string }) {
  return (
    <Icon
      name="progress_activity"
      size={size}
      label={label}
      style={{ animation: 'av-spin .8s linear infinite' }}
    />
  );
}
