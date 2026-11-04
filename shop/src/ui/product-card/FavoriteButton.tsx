import { cx } from '../cx';
import { Icon } from '../icon/Icon';
import s from './ProductCard.module.css';

export function FavoriteButton({
  on = false,
  unavailableReason,
}: {
  on?: boolean;
  unavailableReason?: string;
}) {
  const label = on ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها';
  return (
    <button
      type="button"
      className={cx(s.iconButton, s.favButton, on && s.favOn, unavailableReason && s.placeholder)}
      aria-pressed={on}
      aria-label={unavailableReason ? `${label} (${unavailableReason})` : label}
      aria-disabled={unavailableReason ? true : undefined}
      title={unavailableReason}
    >
      <Icon name="favorite" filled={on} size={21} />
    </button>
  );
}
