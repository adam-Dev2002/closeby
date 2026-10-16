import { useCallback, useEffect, useRef, useState } from 'react';
import { startEmergencyRing } from '../services/emergencyRing';

export function useEmergencyRing(key: string | undefined, appActive: boolean) {
  const stop = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const retry = useCallback(() => {
    stop.current(); setError(null);
    if (key && appActive) stop.current = startEmergencyRing(setError);
  }, [key, appActive]);
  useEffect(() => { retry(); return () => stop.current(); }, [retry]);
  return { error, retry };
}
