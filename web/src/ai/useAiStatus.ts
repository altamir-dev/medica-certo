import { useEffect, useState } from 'react';
import { getAiStatus, type AiStatus } from '../api/ai';

const off: AiStatus = {
  enabled: false,
  providerName: '',
  model: '',
  consented: false,
};

export function useAiStatus() {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAiStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(off);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
