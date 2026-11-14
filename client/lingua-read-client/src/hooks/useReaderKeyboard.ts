import { useEffect, useLayoutEffect, useRef } from 'react';
import type { WordStatus } from '../types/wordStatus';
import { hasModalKeyboardOwner, isInteractiveKeyboardTarget } from '../utils/keyboard';

export type { WordStatus };

export type UseReaderKeyboardArgs = {
  enabled: boolean;
  characterShortcutsEnabled?: boolean;
  modalOpen?: boolean;
  hoveredWordTerm: string | null;
  getShortcutTarget?: () => string | null;
  onSetWordStatus: (term: string, status: WordStatus) => void | Promise<void>;
};

export const useReaderKeyboard = ({
  enabled,
  characterShortcutsEnabled = true,
  modalOpen = false,
  hoveredWordTerm,
  getShortcutTarget,
  onSetWordStatus
}: UseReaderKeyboardArgs): void => {
  const config = useRef({ enabled, characterShortcutsEnabled, modalOpen, hoveredWordTerm, getShortcutTarget, onSetWordStatus });
  useLayoutEffect(() => {
    config.current = { enabled, characterShortcutsEnabled, modalOpen, hoveredWordTerm, getShortcutTarget, onSetWordStatus };
  });
  useEffect(() => {
    let composing = false;
    const onCompositionStart = () => { composing = true; };
    const onCompositionEnd = () => { composing = false; };
    const handleKeyDown = (event: KeyboardEvent) => {
      const current = config.current;
      if (
        event.defaultPrevented ||
        event.repeat || event.isComposing || event.keyCode === 229 || composing ||
        current.modalOpen || hasModalKeyboardOwner() ||
        isInteractiveKeyboardTarget(event.target) ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        return;
      }
      if (!current.enabled || !current.characterShortcutsEnabled) return;
      const target = current.getShortcutTarget ? current.getShortcutTarget() : current.hoveredWordTerm;
      if (!target) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return;
      if (event.key === 'i' || event.key === 'I') {
        event.preventDefault();
        void current.onSetWordStatus(target, 6);
        return;
      }
      if (!/^[1-5]$/.test(event.key) || event.shiftKey) return;
      const key = Number(event.key);
      event.preventDefault();
      void current.onSetWordStatus(target, key as WordStatus);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('compositionstart', onCompositionStart);
    window.addEventListener('compositionend', onCompositionEnd);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('compositionstart', onCompositionStart);
      window.removeEventListener('compositionend', onCompositionEnd);
    };
  }, []);
};
