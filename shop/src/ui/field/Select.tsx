import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon } from '../icon/Icon';
import { cx } from '../cx';
import s from './Field.module.css';

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> & {
  label: ReactNode;
  /** visually hidden label (e.g. the sort control next to a heading) */
  hideLabel?: boolean;
  options: readonly SelectOption[];
  error?: ReactNode;
};

/** Native <select> styled like the design: accessible and uses the phone's own picker. */
export function Select({ label, hideLabel, options, error, id, disabled, ...select }: SelectProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <div className={s.field}>
      <label htmlFor={selectId} className={cx(hideLabel ? 'sr-only' : s.label, disabled && s.disabledLabel)}>
        {label}
      </label>
      <span className={s.selectWrap}>
        <select
          {...select}
          id={selectId}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : undefined}
          className={cx(s.control, s.select)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="keyboard_arrow_down" size={22} className={s.chevron} />
      </span>
      {error && (
        <span id={`${selectId}-error`} className={s.error}>
          <Icon name="error" size={16} />
          {error}
        </span>
      )}
    </div>
  );
}
