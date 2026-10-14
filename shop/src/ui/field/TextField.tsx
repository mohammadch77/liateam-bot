import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../icon/Icon';
import { cx } from '../cx';
import s from './Field.module.css';

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & {
  label: ReactNode;
  /** small grey note after the label, e.g. «اختیاری» */
  labelNote?: ReactNode;
  hint?: ReactNode;
  /** error text; also marks the input aria-invalid */
  error?: ReactNode;
  /** numbers / phone / postal code: left-to-right text, right-aligned like the design */
  ltr?: boolean;
};

export function TextField({ label, labelNote, hint, error, ltr, id, disabled, ...input }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={s.field}>
      <label htmlFor={inputId} className={cx(s.label, disabled && s.disabledLabel)}>
        {label}
        {labelNote && <span className={s.optional}> · {labelNote}</span>}
      </label>
      <input
        {...input}
        id={inputId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(s.control, ltr && s.ltr)}
      />
      {error ? (
        <span id={`${inputId}-error`} className={s.error}>
          <Icon name="error" size={16} />
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${inputId}-hint`} className={s.hint}>
            {hint}
          </span>
        )
      )}
    </div>
  );
}
