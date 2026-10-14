import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '../cx';
import s from './Feedback.module.css';

type AlertTone = 'success' | 'warning' | 'danger';
const ALERT_ICON: Record<AlertTone, IconName> = {
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
};

/** Style sheet «بازخورد»: dark toast for success, warm/red banners for warnings and errors. */
export function Alert({
  tone,
  children,
  action,
}: {
  tone: AlertTone;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div role={tone === 'success' ? 'status' : 'alert'} className={cx(s.alert, s[tone])}>
      <Icon name={ALERT_ICON[tone]} size={20} className={s.alertIcon} />
      <span className={s.alertText}>{children}</span>
      {action && <span className={s.alertAction}>{action}</span>}
    </div>
  );
}

type EmptyTone = 'brand' | 'neutral' | 'danger';

/** Style sheet «حالت‌های خالی و خطا»: round icon, title, hint, one action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  tone = 'brand',
}: {
  icon: IconName;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: EmptyTone;
}) {
  return (
    <div className={cx(s.empty, tone === 'danger' && s.emptyDanger)}>
      <span className={cx(s.emptyIcon, s[`icon-${tone}`])}>
        <Icon name={icon} size={30} />
      </span>
      <b className={s.emptyTitle}>{title}</b>
      {children && <span className={s.emptyText}>{children}</span>}
      {action}
    </div>
  );
}
