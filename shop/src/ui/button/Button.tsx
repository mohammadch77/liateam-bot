import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../icon/Icon';
import { Spinner } from '../spinner/Spinner';
import { cx } from '../cx';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'dark';
export type ButtonSize = 'sm' | 'md' | 'lg';

type CommonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** full width */
  block?: boolean;
  /** shows the spinner and `loadingText`; the button stays its colour but cannot be pressed */
  loading?: boolean;
  loadingText?: ReactNode;
  /** icon before the label (on the right in RTL) */
  icon?: IconName;
  /** icon after the label (on the left in RTL), e.g. arrow_back for «ادامه» */
  iconEnd?: IconName;
  children: ReactNode;
  className?: string;
};

type AsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> & { href?: never };
type AsLink = CommonProps & { href: string; disabled?: boolean };

export type ButtonProps = AsButton | AsLink;

export function Button(props: ButtonProps) {
  // Design-system props are taken out here; whatever remains goes to the DOM element.
  const {
    variant = 'primary',
    size = 'md',
    block,
    loading,
    loadingText,
    icon,
    iconEnd,
    children,
    className,
    ...domProps
  } = props;
  const classes = cx(
    s.button,
    s[variant],
    size !== 'md' && s[size],
    block && s.block,
    loading && s.loading,
    className,
  );
  const content = loading ? (
    <>
      <Spinner />
      {loadingText ?? children}
    </>
  ) : (
    <>
      {icon && <Icon name={icon} size={18} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={18} />}
    </>
  );

  if ('href' in domProps && domProps.href !== undefined) {
    if (domProps.disabled) {
      return (
        <span className={classes} aria-disabled="true" role="link">
          {content}
        </span>
      );
    }
    return (
      <Link href={domProps.href} className={classes}>
        {content}
      </Link>
    );
  }

  const { type = 'button', disabled, ...rest } = domProps as Omit<AsButton, keyof CommonProps>;
  return (
    <button
      {...rest}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {content}
    </button>
  );
}
