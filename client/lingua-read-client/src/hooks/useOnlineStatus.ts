import { useEffect, useRef, useState } from 'react';

export interface UseOnlineStatusOptions {
  /** Fired exactly once per offline → online transition (not on the initial mount). */
  onReconnect?: () => void;
}

export function useOnlineStatus(options: UseOnlineStatusOptions = {}): boolean {
  const { onReconnect } = options;

  // navigator.onLine isn't defined in SSR; default to "online" so the UI doesn't
  // flicker an offline banner during initial render.
  const initial = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const [online, setOnline] = useState<boolean>(initial);
  const lastWasOnlineRef = useRef<boolean>(initial);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => {
      setOnline(true);
      if (!lastWasOnlineRef.current) {
        onReconnect?.();
      }
      lastWasOnlineRef.current = true;
    };
    const handleOffline = () => {
      setOnline(false);
      lastWasOnlineRef.current = false;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onReconnect]);

  return online;
}
