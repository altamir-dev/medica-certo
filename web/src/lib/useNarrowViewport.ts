import { useEffect, useState } from 'react';

/** Matches `max-width: 39em` used across portal styles. */
const NARROW_VIEWPORT_QUERY = '(max-width: 39em)';

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(NARROW_VIEWPORT_QUERY).matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(NARROW_VIEWPORT_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return narrow;
}
