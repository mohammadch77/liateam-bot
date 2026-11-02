'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/ui';
import s from '../account.module.css';

/** A second confirmation (native <dialog>: focus is trapped, Esc closes). Nothing happens until «confirm» is pressed. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
  id,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  id: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={s.dialog} onClose={onClose} aria-labelledby={`${id}-t`} data-confirm-dialog={id}>
      <h2 id={`${id}-t`}>{title}</h2>
      {children}
      <div className={s.btnRow}>
        <Button onClick={onConfirm} loading={busy} loadingText="لطفاً صبر کنید…" data-confirm-yes>
          {confirmLabel}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy} data-confirm-no>
          انصراف
        </Button>
      </div>
    </dialog>
  );
}
