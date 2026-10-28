import { Icon } from '../icon/Icon';
import { Spinner } from '../spinner/Spinner';
import { cx } from '../cx';
import s from './ProductCard.module.css';

/** Visual add-to-cart button in its three design states. */
export function AddToCartButton({
  state,
  unavailableReason,
  productName,
  onClick,
}: {
  state: 'idle' | 'loading' | 'done';
  /** a placeholder that looks like the design and announces why it does nothing */
  unavailableReason?: string;
  /** the product's name, for the screen reader («افزودن X به سبد») */
  productName?: string;
  onClick?: () => void;
}) {
  const cls = state === 'loading' ? s.addLoading : state === 'done' ? s.addDone : s.addIdle;
  const label =
    state === 'loading'
      ? 'در حال افزودن'
      : state === 'done'
        ? 'به سبد افزوده شد'
        : productName
          ? `افزودن ${productName} به سبد خرید`
          : 'افزودن به سبد خرید';
  return (
    <button
      type="button"
      className={cx(s.iconButton, cls, unavailableReason && s.placeholder)}
      aria-label={unavailableReason ? `${label} (${unavailableReason})` : label}
      aria-disabled={unavailableReason ? true : undefined}
      title={unavailableReason}
      aria-busy={state === 'loading'}
      onClick={onClick}
      data-cart-add={state}
    >
      {state === 'loading' ? (
        <Spinner />
      ) : (
        <Icon name={state === 'done' ? 'check' : 'add_shopping_cart'} size={21} />
      )}
    </button>
  );
}
