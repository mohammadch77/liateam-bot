'use client';

import { useState } from 'react';
import { Button } from '@/ui';

/** Copies a text (the referral link or code) and says so for two seconds. Falls back to selecting nothing when the browser refuses. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      icon={done ? 'check' : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
      data-copy
    >
      {done ? 'کپی شد' : label}
    </Button>
  );
}
