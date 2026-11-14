import type { WordStatus } from '../types/wordStatus';

/** Temporary navigation identity, never a vocabulary ID or a persisted setting. */
export type ReaderOccurrence = Readonly<{
  id: string;
  generation: string;
  blockId: string;
  /** UTF-16 coordinates in this renderer block's substituted text. */
  start: number;
  end: number;
  term: string;
  entityKey: string;
  sentence: string;
  languageCode?: string;
}>;

/** Call at the rendering seam, using its existing source mapping, not a term search. */
export function createReaderOccurrence({
  processedText, ...source
}: Omit<ReaderOccurrence, 'id'> & { processedText: string }): ReaderOccurrence {
  const { start, end, term, generation, blockId } = source;
  const splitsSurrogate = (index: number) => index > 0 && index < processedText.length &&
    /[\uD800-\uDBFF]/u.test(processedText[index - 1]) && /[\uDC00-\uDFFF]/u.test(processedText[index]);
  if (!generation || !blockId || !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0 || end <= start || end > processedText.length ||
      splitsSurrogate(start) || splitsSurrogate(end) || processedText.slice(start, end) !== term) {
    throw new Error('Reader occurrences require validated renderer UTF-16 spans');
  }
  return { ...source, id: JSON.stringify([generation, blockId, start, end]) };
}

export type ReaderMode = 'reading' | 'interacting' | 'lookup';
export type ReaderFocusRequest = Readonly<{
  sequence: number;
  generation: string;
  target: string | null; // null means the passage entry point
}>;
export type ReaderInteractionState = Readonly<{
  generation: string;
  /** Top-level rendered units, already in logical source order. Phrases occur once. */
  occurrences: readonly ReaderOccurrence[];
  mode: ReaderMode;
  inputOwner: 'pointer' | 'keyboard';
  pointerId: string | null;
  keyboardId: string | null;
  pointerPoint: Readonly<{ x: number; y: number }> | null;
  lookup: Readonly<{ returnId: string | null; resumeMode: 'reading' | 'interacting'; closing: boolean }> | null;
  focusRequest: ReaderFocusRequest | null;
  focusSequence: number;
}>;

export type ReaderInteractionAction =
  | { type: 'registry'; generation: string; occurrences: readonly ReaderOccurrence[] }
  | { type: 'enter'; generation: string; focus?: boolean }
  | { type: 'move'; generation: string; delta: -1 | 1; focus?: boolean }
  | { type: 'focus-occurrence'; generation: string; id: string }
  | { type: 'pointer-move'; generation: string; id: string | null; x: number; y: number; movementX?: number; movementY?: number }
  | { type: 'leave'; generation: string }
  | { type: 'exit'; generation: string }
  | { type: 'open-lookup'; generation: string; id?: string }
  | { type: 'close-lookup'; generation: string }
  | { type: 'focus-settled'; generation: string; sequence: number; found: boolean };

function validateRegistry(generation: string, occurrences: readonly ReaderOccurrence[]): void {
  const seen = new Set<string>();
  const blockEnds = new Map<string, number>();
  const closedBlocks = new Set<string>();
  let lastBlock: string | null = null;
  for (const occurrence of occurrences) {
    if (occurrence.generation !== generation || seen.has(occurrence.id) ||
        occurrence.id !== JSON.stringify([generation, occurrence.blockId, occurrence.start, occurrence.end]) ||
        !Number.isInteger(occurrence.start) || !Number.isInteger(occurrence.end) || occurrence.start < 0 ||
        occurrence.end <= occurrence.start || occurrence.start < (blockEnds.get(occurrence.blockId) ?? 0) ||
        (lastBlock !== occurrence.blockId && closedBlocks.has(occurrence.blockId))) {
      throw new Error('Reader registry must contain current, nonoverlapping top-level units in source order');
    }
    if (lastBlock !== null && lastBlock !== occurrence.blockId) closedBlocks.add(lastBlock);
    lastBlock = occurrence.blockId;
    blockEnds.set(occurrence.blockId, occurrence.end);
    seen.add(occurrence.id);
  }
}

export function createReaderInteractionState(
  generation: string, occurrences: readonly ReaderOccurrence[] = []
): ReaderInteractionState {
  validateRegistry(generation, occurrences);
  return {
    generation, occurrences, mode: 'reading', inputOwner: 'pointer', pointerId: null,
    keyboardId: null, pointerPoint: null, lookup: null, focusRequest: null, focusSequence: 0,
  };
}

export function findReaderOccurrence(state: ReaderInteractionState, id: string | null): ReaderOccurrence | null {
  return state.occurrences.find(occurrence => occurrence.id === id) ?? null;
}

/** The sole shortcut resolver. Save callers capture this result before any await. */
export function getReaderShortcutTarget(state: ReaderInteractionState): ReaderOccurrence | null {
  if (state.mode === 'lookup') return null;
  return findReaderOccurrence(state, state.inputOwner === 'pointer' ? state.pointerId :
    state.mode === 'interacting' ? state.keyboardId : null);
}

export type ReaderStatusIntent = Readonly<{
  generation: string;
  occurrenceId: string;
  entityKey: string;
  term: string;
  sentence: string;
  languageCode?: string;
  status: WordStatus;
}>;

export function captureReaderStatusIntent(state: ReaderInteractionState, status: WordStatus): ReaderStatusIntent | null {
  const occurrence = getReaderShortcutTarget(state);
  return occurrence ? {
    generation: state.generation, occurrenceId: occurrence.id, entityKey: occurrence.entityKey,
    term: occurrence.term, sentence: occurrence.sentence, languageCode: occurrence.languageCode, status,
  } : null;
}

function requestFocus(state: ReaderInteractionState, target: string | null): ReaderInteractionState {
  const sequence = state.focusSequence + 1;
  return { ...state, focusSequence: sequence, focusRequest: { sequence, generation: state.generation, target } };
}

/** Pure: DOM focus, mounting virtual rows, network writes, and speech live in adapters. */
export function readerInteractionReducer(state: ReaderInteractionState, action: ReaderInteractionAction): ReaderInteractionState {
  if (action.type === 'registry') {
    validateRegistry(action.generation, action.occurrences);
    if (action.generation !== state.generation) {
      const next = { ...createReaderInteractionState(action.generation, action.occurrences), focusSequence: state.focusSequence };
      return state.mode !== 'reading' || state.focusRequest ? requestFocus(next, null) : next;
    }
    // Render adapters may recreate descriptors after a status/style update. A
    // logically unchanged registry must not cause a render/effect update loop.
    if (action.occurrences.length === state.occurrences.length && action.occurrences.every((unit, index) => {
      const previous = state.occurrences[index];
      return unit.id === previous.id && unit.term === previous.term && unit.entityKey === previous.entityKey &&
        unit.sentence === previous.sentence && unit.languageCode === previous.languageCode;
    })) return state;
    const next = { ...state, occurrences: action.occurrences };
    const valid = (id: string | null) => findReaderOccurrence(next, id)?.id ?? null;
    if ((state.keyboardId && !valid(state.keyboardId)) || (state.lookup?.returnId && !valid(state.lookup.returnId))) {
      return requestFocus({ ...next, mode: 'reading', keyboardId: null, pointerId: valid(state.pointerId), lookup: null }, null);
    }
    return { ...next, pointerId: valid(state.pointerId) };
  }
  if (action.generation !== state.generation) return state;
  switch (action.type) {
    case 'enter': {
      if (state.mode === 'lookup') return state;
      const keyboardId = findReaderOccurrence(state, state.keyboardId)?.id ?? state.occurrences[0]?.id ?? null;
      const next = { ...state, mode: 'interacting' as const, inputOwner: 'keyboard' as const, keyboardId };
      return action.focus === false || !keyboardId ? next : requestFocus(next, keyboardId);
    }
    case 'move': {
      if (state.mode === 'lookup' || !state.occurrences.length) return state;
      const index = state.occurrences.findIndex(occurrence => occurrence.id === state.keyboardId);
      const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(state.occurrences.length - 1, index + action.delta));
      const keyboardId = state.occurrences[nextIndex].id;
      const next = { ...state, mode: 'interacting' as const, inputOwner: 'keyboard' as const, keyboardId };
      return action.focus === false ? next : requestFocus(next, keyboardId);
    }
    case 'focus-occurrence':
      return state.mode === 'lookup' || !findReaderOccurrence(state, action.id) ? state :
        { ...state, mode: 'interacting', inputOwner: 'keyboard', keyboardId: action.id };
    case 'pointer-move': {
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return state;
      const moved = state.pointerPoint ? state.pointerPoint.x !== action.x || state.pointerPoint.y !== action.y :
        Boolean(action.movementX || action.movementY);
      const next = { ...state, pointerPoint: { x: action.x, y: action.y } };
      if (!moved || state.mode === 'lookup') return next;
      const pointerId = findReaderOccurrence(state, action.id)?.id ?? null;
      // Moving to native controls must not erase a keyboard-selected target.
      return { ...next, inputOwner: pointerId ? 'pointer' : state.inputOwner, pointerId };
    }
    case 'leave':
      return state.mode === 'lookup' ? state : { ...state, mode: 'reading', focusRequest: null };
    case 'exit':
      return state.mode === 'lookup' ? state : requestFocus({ ...state, mode: 'reading' }, null);
    case 'open-lookup': {
      if (state.mode === 'lookup') return state;
      const target = action.id ? findReaderOccurrence(state, action.id) : getReaderShortcutTarget(state);
      return !target ? state : {
        ...state, mode: 'lookup', lookup: { returnId: target.id, resumeMode: state.mode, closing: false }, focusRequest: null,
      };
    }
    case 'close-lookup':
      return state.lookup && !state.lookup.closing ? requestFocus({ ...state, lookup: { ...state.lookup, closing: true } },
        findReaderOccurrence(state, state.lookup.returnId)?.id ?? null) : state;
    case 'focus-settled': {
      if (state.focusRequest?.sequence !== action.sequence) return state;
      if (state.lookup?.closing) return {
        ...state, mode: action.found ? state.lookup.resumeMode : 'reading', lookup: null, focusRequest: null,
      };
      return action.found ? { ...state, focusRequest: null } : { ...state, mode: 'reading', focusRequest: null };
    }
  }
}

/** Horizontal candidates only. Up/Down remain native scrolling/sentence controls. */
export function readerNavigationDelta(key: string, direction: 'ltr' | 'rtl'): -1 | 1 | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  return (key === 'ArrowRight') === (direction === 'ltr') ? 1 : -1;
}
