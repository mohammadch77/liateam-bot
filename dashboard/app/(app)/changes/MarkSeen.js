'use client';
import { useEffect } from 'react';
// Remembers (per browser) the newest change already seen, for the unread badge in the menu.
export default function MarkSeen({ maxId }) {
  useEffect(() => {
    try {
      if (maxId > Number(localStorage.getItem('eventsSeen') || 0)) localStorage.setItem('eventsSeen', String(maxId));
      window.dispatchEvent(new Event('events-seen'));
    } catch {}
  }, [maxId]);
  return null;
}
