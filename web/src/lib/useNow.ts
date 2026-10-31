import { useEffect, useState } from 'react';

/** Ticks every `intervalMs` (default 1s) for realtime clock. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Only updates when the civil minute (America/Sao_Paulo) changes.
 * Use for nearest-slot highlight so the grid does not re-render every second.
 */
export function useNowMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => {
      const next = new Date();
      setNow((prev) => {
        const a = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(prev);
        const b = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/Sao_Paulo',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(next);
        return a === b ? prev : next;
      });
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
