import { describe, expect, test } from 'vitest';
import {
  captureReaderStatusIntent, createReaderInteractionState, createReaderOccurrence,
  getReaderShortcutTarget, readerInteractionReducer, readerNavigationDelta,
} from '../utils/readerInteraction';
import type { ReaderInteractionState } from '../utils/readerInteraction';

const generation = 'passage-1:render-1';
const source = 'Alpha New York harbour Alpha 𠮷 e\u0301';
const occurrence = (start: number, end: number, entityKey = source.slice(start, end), gen = generation) => createReaderOccurrence({
  generation: gen, blockId: 'block-1', processedText: source, start, end,
  term: source.slice(start, end), entityKey, sentence: source, languageCode: 'en',
});
// A rendered longest-match phrase is one unit. Its inner/overlapping words are absent.
const units = [occurrence(0, 5, 'saved:1'), occurrence(6, 22, 'saved:2'), occurrence(23, 28, 'saved:1'), occurrence(29, 31), occurrence(32, 34)];
const initial = () => createReaderInteractionState(generation, units);
const enter = (state = initial()) => readerInteractionReducer(state, { type: 'enter', generation });
const move = (state: ReaderInteractionState, delta: -1 | 1) => readerInteractionReducer(state, { type: 'move', generation, delta });

describe('reader interaction source and target invariants', () => {
  test('passage Tab and explicit native entry share one transition and remembered anchor', () => {
    const tab = enter();
    const explicit = enter();
    expect(tab).toEqual(explicit);
    const navigated = move(tab, 1);
    const left = readerInteractionReducer(navigated, { type: 'leave', generation });
    expect(left.mode).toBe('reading');
    expect(enter(left).keyboardId).toBe(units[1].id);
  });

  test('movement follows top-level phrase/source order and clamps at boundaries', () => {
    let state = enter();
    expect(move(state, -1).keyboardId).toBe(units[0].id);
    state = move(state, 1);
    expect(getReaderShortcutTarget(state)?.term).toBe('New York harbour');
    expect(move(state, 1).keyboardId).toBe(units[2].id);
    for (let i = 0; i < 10; i++) state = move(state, 1);
    expect(state.keyboardId).toBe(units.at(-1)?.id);
    expect(readerNavigationDelta('ArrowLeft', 'rtl')).toBe(1);
    expect(readerNavigationDelta('ArrowRight', 'rtl')).toBe(-1);
    expect(readerNavigationDelta('ArrowRight', 'ltr')).toBe(1);
    expect(readerNavigationDelta('ArrowDown', 'ltr')).toBeNull();
  });

  test('pointer owns shortcuts only after actual coordinate movement; it never changes the keyboard anchor', () => {
    let state = enter();
    state = readerInteractionReducer(state, { type: 'pointer-move', generation, id: units[0].id, x: 12, y: 8 });
    state = move(state, 1);
    const focusRequest = state.focusRequest;
    const controls = readerInteractionReducer(state, { type: 'pointer-move', generation, id: null, x: 14, y: 8 });
    expect(getReaderShortcutTarget(controls)?.id).toBe(units[1].id);
    state = readerInteractionReducer(state, { type: 'pointer-move', generation, id: units[2].id, x: 12, y: 8 });
    expect(getReaderShortcutTarget(state)?.id).toBe(units[1].id);
    state = readerInteractionReducer(state, { type: 'pointer-move', generation, id: units[0].id, x: 13, y: 8 });
    expect(getReaderShortcutTarget(state)?.id).toBe(units[0].id);
    expect(state.keyboardId).toBe(units[1].id);
    expect(state.focusRequest).toBe(focusRequest);
  });

  test('a status intent synchronously captures identity and context before navigation or later refresh', () => {
    const state = move(enter(), 1);
    const intent = captureReaderStatusIntent(state, 3);
    const moved = move(state, 1);
    expect(intent).toEqual({ generation, occurrenceId: units[1].id, entityKey: 'saved:2', term: 'New York harbour',
      sentence: source, languageCode: 'en', status: 3 });
    expect(captureReaderStatusIntent(moved, 4)?.entityKey).toBe('saved:1');
    expect(intent?.status).toBe(3);
  });

  test('lookup restores the exact repeated occurrence, and stays guarded until focus settles', () => {
    let state = move(move(enter(), 1), 1);
    state = readerInteractionReducer(state, { type: 'open-lookup', generation });
    expect(state.lookup).toEqual({ returnId: units[2].id, resumeMode: 'interacting', closing: false });
    expect(getReaderShortcutTarget(state)).toBeNull();
    expect(move(state, 1)).toBe(state);
    state = readerInteractionReducer(state, { type: 'close-lookup', generation });
    expect(state.mode).toBe('lookup');
    expect(state.focusRequest?.target).toBe(units[2].id);
    state = readerInteractionReducer(state, { type: 'focus-settled', generation, sequence: state.focusRequest!.sequence, found: true });
    expect(state.mode).toBe('interacting');
    expect(state.keyboardId).toBe(units[2].id);
  });

  test('Escape returns to entry while retaining navigation memory; Tab requests no focus redirect', () => {
    const state = move(enter(), 1);
    const escaped = readerInteractionReducer(state, { type: 'exit', generation });
    expect(escaped.mode).toBe('reading');
    expect(escaped.focusRequest?.target).toBeNull();
    expect(escaped.keyboardId).toBe(units[1].id);
    expect(getReaderShortcutTarget(escaped)).toBeNull();
    const tab = readerInteractionReducer(state, { type: 'leave', generation });
    expect(tab.mode).toBe('reading');
    expect(tab.focusRequest).toBeNull();
  });

  test('generation change invalidates anchors and ignores late old-generation UI effects', () => {
    let state = readerInteractionReducer(enter(), { type: 'open-lookup', generation });
    state = readerInteractionReducer(state, { type: 'registry', generation: 'replacement', occurrences: [] });
    expect(state).toMatchObject({ generation: 'replacement', mode: 'reading', keyboardId: null, pointerId: null, lookup: null });
    expect(readerInteractionReducer(state, { type: 'move', generation, delta: 1 })).toBe(state);
    expect(readerInteractionReducer(state, { type: 'focus-settled', generation, sequence: 1, found: true })).toBe(state);
  });

  test('ordinary status/style registry refresh retains IDs; removal safely requests entry', () => {
    const state = move(enter(), 1);
    const refreshed = readerInteractionReducer(state, { type: 'registry', generation, occurrences: units.map(unit => ({ ...unit })) });
    expect(refreshed).toBe(state);
    expect(refreshed.keyboardId).toBe(state.keyboardId);
    const removed = readerInteractionReducer(refreshed, { type: 'registry', generation, occurrences: [units[0]] });
    expect(removed.mode).toBe('reading');
    expect(removed.focusRequest?.target).toBeNull();
  });

  test('validated UTF-16 spans distinguish repeats and retain supplementary/combining characters', () => {
    expect(units[0].id).not.toBe(units[2].id);
    expect(units[0].entityKey).toBe(units[2].entityKey);
    expect(units[3]).toMatchObject({ term: '𠮷', start: 29, end: 31 });
    expect(units[4].term).toBe('e\u0301');
    expect(() => occurrence(29, 30)).toThrow(/validated renderer UTF-16/);
    expect(() => createReaderOccurrence({ ...units[0], processedText: source, term: 'wrong' })).toThrow();
  });

  test('overlapping/hidden phrase stops, stale generations and out-of-source-order units are rejected', () => {
    expect(() => createReaderInteractionState(generation, [units[0], units[1], occurrence(10, 14)])).toThrow(/nonoverlapping/);
    expect(() => createReaderInteractionState(generation, [units[2], units[0]])).toThrow();
    expect(() => createReaderInteractionState(generation, [occurrence(0, 5, 'saved:1', 'obsolete')])).toThrow();
  });
});
