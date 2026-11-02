'use client';

import { Button, EmptyState } from '@/ui';

export default function AccountError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      icon="error"
      tone="danger"
      title="بارگذاری این بخش ممکن نشد"
      action={
        <Button variant="outline" icon="refresh" onClick={reset}>
          تلاش دوباره
        </Button>
      }
    >
      چند لحظه بعد دوباره تلاش کنید.
    </EmptyState>
  );
}
