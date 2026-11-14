import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, HTMLAttributes, MouseEvent, RefCallback } from 'react';
import type { WordStatus } from '../types/wordStatus';
import { hasModalKeyboardOwner, isInteractiveKeyboardTarget } from '../utils/keyboard';
import {
  captureReaderStatusIntent, createReaderInteractionState, findReaderOccurrence,
  getReaderShortcutTarget, readerInteractionReducer, readerNavigationDelta,
} from '../utils/readerInteraction';
import type { ReaderInteractionAction, ReaderOccurrence, ReaderStatusIntent } from '../utils/readerInteraction';

export type UseReaderInteractionOptions = {
  generation: string;
  occurrences: readonly ReaderOccurrence[];
  direction?: 'ltr' | 'rtl';
  enabled?: boolean;
  characterShortcutsEnabled?: boolean;
  modalOwned?: boolean;
  instructionsId?: string;
  targetDescriptionId?: string;
  onStatusIntent: (intent: ReaderStatusIntent) => void | Promise<void>;
  /** Mount/scroll the source row without seeking audio; respect signal cancellation. */
  ensureOccurrenceMounted?: (occurrence: ReaderOccurrence, signal: AbortSignal) => void | Promise<void>;
};

const hasSelection = () => {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed;
};

/** Experimental adapter; production ARIA/key semantics still require manual AT evidence. */
export function useReaderInteraction(options: UseReaderInteractionOptions) {
  const [state, setState] = useState(() => createReaderInteractionState(options.generation, options.occurrences));
  const stateRef = useRef(state);
  const optionsRef = useRef(options);
  const entryRef = useRef<HTMLDivElement | null>(null);
  const elements = useRef(new Map<string, HTMLSpanElement>());
  const suppressEntry = useRef(false);
  // Keyboard target capture is synchronous even when multiple events arrive before a render.
  const send = useCallback((action: ReaderInteractionAction) => {
    const next = readerInteractionReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);
  useLayoutEffect(() => { optionsRef.current = options; });
  useLayoutEffect(() => {
    send({ type: 'registry', generation: options.generation, occurrences: options.occurrences });
  }, [options.generation, options.occurrences, send]);

  useLayoutEffect(() => {
    const request = state.focusRequest;
    if (!request) return;
    const abort = new AbortController();
    const restore = async () => {
      const occurrence = findReaderOccurrence(stateRef.current, request.target);
      if (occurrence && !elements.current.get(occurrence.id)?.isConnected) {
        try { await optionsRef.current.ensureOccurrenceMounted?.(occurrence, abort.signal); }
        catch { /* A vanished virtual row falls back to the passage entry. */ }
      }
      if (abort.signal.aborted || stateRef.current.generation !== request.generation ||
          stateRef.current.focusRequest?.sequence !== request.sequence) return;
      const token = request.target ? elements.current.get(request.target) : null;
      const found = !!token?.isConnected;
      const target = found ? token : entryRef.current;
      // Escape/fallback focus must not immediately re-enter through onFocus.
      suppressEntry.current = !found;
      target?.focus({ preventScroll: true });
      suppressEntry.current = false;
      if (found) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
      }
      send({ type: 'focus-settled', generation: request.generation, sequence: request.sequence, found: request.target === null || found });
    };
    void restore();
    return () => abort.abort();
  }, [state.focusRequest, send]);

  const enter = useCallback((focus = true) => send({ type: 'enter', generation: stateRef.current.generation, focus }), [send]);
  const move = useCallback((delta: -1 | 1, focus = true) => send({ type: 'move', generation: stateRef.current.generation, delta, focus }), [send]);
  const exit = useCallback(() => send({ type: 'exit', generation: stateRef.current.generation }), [send]);
  const openLookup = useCallback((id?: string) => {
    if (!hasSelection()) send({ type: 'open-lookup', generation: stateRef.current.generation, id });
  }, [send]);
  const closeLookup = useCallback(() => send({ type: 'close-lookup', generation: stateRef.current.generation }), [send]);
  const setStatus = useCallback((status: WordStatus) => {
    const intent = captureReaderStatusIntent(stateRef.current, status);
    if (intent) void optionsRef.current.onStatusIntent(intent);
  }, []);

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (optionsRef.current.enabled === false || optionsRef.current.modalOwned || hasModalKeyboardOwner() ||
          event.pointerType === 'touch' || event.buttons || hasSelection()) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-reader-occurrence]') : null;
      const id = target && entryRef.current?.contains(target) ? target.dataset.readerOccurrence ?? null : null;
      send({ type: 'pointer-move', generation: stateRef.current.generation, id,
        x: event.clientX, y: event.clientY, movementX: event.movementX, movementY: event.movementY });
    };
    const keyboard = (event: KeyboardEvent) => {
      const current = stateRef.current;
      const config = optionsRef.current;
      const target = event.target;
      if (config.enabled === false || config.modalOwned || hasModalKeyboardOwner() || event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
          event.ctrlKey || event.altKey || event.metaKey || isInteractiveKeyboardTarget(target) ||
          (target instanceof Element && !!target.closest('dialog, [role="dialog"], [aria-modal="true"]')) || hasSelection()) return;
      const inPassage = target instanceof Node && !!entryRef.current?.contains(target);
      if (current.mode === 'lookup') return; // The named modal/nonmodal lookup owns dismissal.
      if (inPassage && event.key === 'Tab') {
        // Retain the roving stop until native blur: making the ancestor tabbable
        // during keydown would let Shift+Tab re-enter that ancestor and loop.
        return;
      }
      if (inPassage && current.mode === 'interacting') {
        const delta = readerNavigationDelta(event.key, config.direction ?? 'ltr');
        if (delta) { event.preventDefault(); move(delta); return; }
        if (event.key === 'Escape') { event.preventDefault(); exit(); return; }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); openLookup(current.keyboardId ?? undefined); return;
        }
      }
      if (config.characterShortcutsEnabled === false || event.repeat) return;
      const status = /^[1-5]$/u.test(event.key) ? Number(event.key) as WordStatus : /^[iI]$/u.test(event.key) ? 6 : null;
      if (status && getReaderShortcutTarget(current)) { event.preventDefault(); setStatus(status); }
    };
    window.addEventListener('pointermove', pointer, { passive: true });
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('keydown', keyboard);
    };
  }, [exit, move, openLookup, send, setStatus]);

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !suppressEntry.current && options.enabled !== false) enter();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) send({ type: 'leave', generation: stateRef.current.generation });
  };
  const passageProps: HTMLAttributes<HTMLDivElement> & { ref: typeof entryRef } = {
    ref: entryRef,
    tabIndex: state.mode === 'interacting' && state.keyboardId ? -1 : 0,
    'aria-describedby': options.instructionsId,
    onFocus, onBlur,
  };
  const getOccurrenceProps = (occurrence: ReaderOccurrence): HTMLAttributes<HTMLSpanElement> & {
    ref: RefCallback<HTMLSpanElement>; 'data-reader-occurrence': string;
  } => {
    return {
      ref: element => { if (element) elements.current.set(occurrence.id, element); else elements.current.delete(occurrence.id); },
      'data-reader-occurrence': occurrence.id,
      'aria-describedby': options.targetDescriptionId,
      tabIndex: state.mode === 'interacting' && state.keyboardId === occurrence.id ? 0 : -1,
      onFocus: () => send({ type: 'focus-occurrence', generation: occurrence.generation, id: occurrence.id }),
      onClick: (event: MouseEvent<HTMLSpanElement>) => {
        if (!hasSelection()) { event.stopPropagation(); openLookup(occurrence.id); }
      },
    };
  };
  return {
    state, passageProps, getOccurrenceProps, enter, move, exit, openLookup, closeLookup, setStatus,
    shortcutTarget: getReaderShortcutTarget(state),
    lookupTarget: findReaderOccurrence(state, state.lookup?.returnId ?? null),
    isLookupOpen: state.mode === 'lookup' && !!state.lookup && !state.lookup.closing,
  };
}
