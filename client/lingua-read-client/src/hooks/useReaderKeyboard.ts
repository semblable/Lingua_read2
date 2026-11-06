import { useEffect } from 'react';
import type { WordStatus } from '../types/wordStatus';
import { isInteractiveKeyboardTarget } from '../utils/keyboard';

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
      if (
        event.defaultPrevented ||
        isInteractiveKeyboardTarget(event.target) ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      if (!enabled || !hoveredWordTerm) return;
      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault();
        void onSetWordStatus(hoveredWordTerm, 6);
        return;
      }
      const key = parseInt(event.key, 10);
      if (!Number.isInteger(key) || key < 1 || key > 5) return;
      event.preventDefault();
      void onSetWordStatus(hoveredWordTerm, key as WordStatus);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, hoveredWordTerm, onSetWordStatus]);
};
