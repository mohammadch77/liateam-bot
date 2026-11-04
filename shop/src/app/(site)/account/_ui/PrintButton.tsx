'use client';

import { Button } from '@/ui';

/**
 * «ذخیره به‌صورت PDF»: the browser's own print dialog (its «Save as PDF»). The report is a page of real text in Avina's font and RTL,
 * so the Persian letters are shaped by the browser; the menus, the header and the buttons are hidden by PrintStyles.
 */
export function PrintButton({ label = 'ذخیره به‌صورت PDF' }: { label?: string }) {
  return (
    <Button type="button" variant="outline" icon="assignment_return" onClick={() => window.print()} data-print-pdf data-no-print>
      {label}
    </Button>
  );
}

/** Print rules for a report page: only the report is drawn, on white, with the buttons left out. */
export function PrintStyles() {
  return (
    <style>{`@media print{header,footer,nav,[data-account-nav],[data-admin-nav],[data-bottom-nav],[data-no-print],[data-back]{display:none!important}
    body{background:#fff!important}main{padding:0!important}@page{margin:14mm}}`}</style>
  );
}
