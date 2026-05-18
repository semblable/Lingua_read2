import { useEffect } from 'react';
import type { WordStatus } from '../types/wordStatus';

export type { WordStatus };

export type UseReaderKeyboardArgs = {
  enabled: boolean;
  hoveredWordTerm: string | null;
  onSetWordStatus: (term: string, status: WordStatus) => void | Promise<void>;
};

export const useReaderKeyboard = ({
  enabled,
  hoveredWordTerm,
  onSetWordStatus
}: UseReaderKeyboardArgs): void => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      if (!enabled || !hoveredWordTerm) return;
      const key = parseInt(event.key, 10);
      if (!Number.isInteger(key) || key < 1 || key > 5) return;
      event.preventDefault();
      void onSetWordStatus(hoveredWordTerm, key as WordStatus);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, hoveredWordTerm, onSetWordStatus]);
};
