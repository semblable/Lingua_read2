import { describe, test, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderKeyboard } from '../hooks/useReaderKeyboard';

const fireKey = (key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useReaderKeyboard', () => {
  test('captures the current pointer target synchronously before a React hover render', () => {
    let target = 'first';
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'stale',
      getShortcutTarget: () => target, onSetWordStatus }));
    target = 'second';
    fireKey('4');
    expect(onSetWordStatus).toHaveBeenCalledWith('second', 4);
    target = null;
    fireKey('3');
    expect(onSetWordStatus).toHaveBeenCalledTimes(1);
  });
  test.each(['select', 'button', 'a', 'div'])('leaves keys to interactive targets: %s', tag => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'cat', onSetWordStatus }));
    const element = document.createElement(tag);
    if (tag === 'div') element.setAttribute('contenteditable', 'true');
    document.body.append(element);
    try { element.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
      expect(onSetWordStatus).not.toHaveBeenCalled();
    } finally { element.remove(); }
  });
  test('returns void (pure side-effect hook)', () => {
    const onSetWordStatus = vi.fn();
    const { result } = renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'hello', onSetWordStatus })
    );
    expect(result.current).toBeUndefined();
  });

  test('invokes onSetWordStatus for keys 1-5 when enabled and a word is hovered', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'hola', onSetWordStatus })
    );

    fireKey('3');
    expect(onSetWordStatus).toHaveBeenCalledWith('hola', 3);
  });

  test('invokes onSetWordStatus with status 6 for the "i" key (ignore)', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'hola', onSetWordStatus })
    );

    fireKey('i');
    expect(onSetWordStatus).toHaveBeenCalledWith('hola', 6);
  });

  test('invokes onSetWordStatus with status 6 for the uppercase "I" key', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'hola', onSetWordStatus })
    );

    fireKey('I');
    expect(onSetWordStatus).toHaveBeenCalledWith('hola', 6);
  });

  test('does not invoke "i" (ignore) when disabled', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: false, hoveredWordTerm: 'hola', onSetWordStatus })
    );

    fireKey('i');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('does not invoke "i" (ignore) when no word is hovered', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: null, onSetWordStatus })
    );

    fireKey('i');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('does nothing when no word is hovered', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: null, onSetWordStatus })
    );

    fireKey('2');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('does nothing when disabled', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: false, hoveredWordTerm: 'word', onSetWordStatus })
    );

    fireKey('1');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('ignores non-1-5 keys', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'word', onSetWordStatus })
    );

    fireKey('6');
    fireKey('0');
    fireKey('q');
    fireKey('Enter');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('ignores keys typed inside input/textarea elements', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'word', onSetWordStatus })
    );

    const event = new KeyboardEvent('keydown', { key: '4', bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(onSetWordStatus).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  test('ignores keys with modifier keys held', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'word', onSetWordStatus })
    );

    const event = new KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('removes listener on unmount', () => {
    const onSetWordStatus = vi.fn();
    const { unmount } = renderHook(() =>
      useReaderKeyboard({ enabled: true, hoveredWordTerm: 'word', onSetWordStatus })
    );

    unmount();
    fireKey('2');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test.each([
    { repeat: true }, { isComposing: true }, { keyCode: 229 },
    { altKey: true }, { metaKey: true }, { shiftKey: true },
  ])('leaves repeated, IME and modified number keys alone: %j', options => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'cat', onSetWordStatus }));
    const event = new KeyboardEvent('keydown', { key: '3', cancelable: true, ...options });
    window.dispatchEvent(event);
    expect(onSetWordStatus).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  test('retains deliberate status presses but suppresses a held ignore key', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'cat', onSetWordStatus }));
    fireKey('3');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', repeat: true }));
    fireKey('4');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'I', repeat: true }));
    expect(onSetWordStatus.mock.calls).toEqual([['cat', 3], ['cat', 4]]);
  });

  test('respects character shortcut preferences', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, characterShortcutsEnabled: false, hoveredWordTerm: 'cat', onSetWordStatus }));
    fireKey('3');
    fireKey('i');
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });

  test('suppresses shortcuts throughout an IME composition, even without isComposing on a key', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'cat', onSetWordStatus }));
    window.dispatchEvent(new Event('compositionstart'));
    fireKey('3');
    expect(onSetWordStatus).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('compositionend'));
    fireKey('3');
    expect(onSetWordStatus).toHaveBeenCalledOnce();
  });

  test.each(['dialog', 'alertdialog'])('a modal owns shortcuts even when its focus is still moving: %s', role => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'cat', onSetWordStatus }));
    const modal = document.createElement('div');
    modal.setAttribute('role', role);
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    try {
      fireKey('3');
      expect(onSetWordStatus).not.toHaveBeenCalled();
      modal.hidden = true;
      fireKey('3');
      expect(onSetWordStatus).toHaveBeenCalledOnce();
    } finally { modal.remove(); }
  });

  test('does not consume selection gestures or keys already handled by another control', () => {
    const onSetWordStatus = vi.fn();
    renderHook(() => useReaderKeyboard({ enabled: true, hoveredWordTerm: 'cat', onSetWordStatus }));
    const text = document.createTextNode('Native text selection');
    document.body.append(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    try { fireKey('3'); expect(onSetWordStatus).not.toHaveBeenCalled(); }
    finally { selection.removeAllRanges(); text.remove(); }
    const handled = new KeyboardEvent('keydown', { key: '3', cancelable: true });
    handled.preventDefault(); window.dispatchEvent(handled);
    expect(onSetWordStatus).not.toHaveBeenCalled();
  });
});
