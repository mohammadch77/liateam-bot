import type { InputHTMLAttributes, ReactNode } from 'react';
import { formatNumber } from '@/lib/format/number';
import { Icon } from '../icon/Icon';
import { cx } from '../cx';
import s from './Field.module.css';

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'children'> & {
  children: ReactNode;
};

/** Filter checkbox (style sheet «فیلترها»). A real <input type=checkbox>, so it also works in a plain GET form. */
export function Checkbox({ children, count, disabled, ...input }: BaseProps & { count?: number }) {
  return (
    <label className={cx(s.check, disabled && s.checkDisabled)}>
      <input {...input} type="checkbox" disabled={disabled} className={s.nativeInput} />
      <span className={s.box} aria-hidden="true">
        <Icon name="check" size={16} />
      </span>
      <span>
        {children}
        {count !== undefined && <span className={s.count}> ({formatNumber(count)})</span>}
      </span>
    </label>
  );
}

/** On/off switch, e.g. «فقط کالاهای موجود». */
export function Switch({ children, disabled, ...input }: BaseProps) {
  return (
    <label className={cx(s.check, s.switchRow, disabled && s.checkDisabled)}>
      <input {...input} type="checkbox" role="switch" disabled={disabled} className={s.nativeInput} />
      <span className={s.track} aria-hidden="true">
        <span className={s.thumb} />
      </span>
      <span>{children}</span>
    </label>
  );
}
