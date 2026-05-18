import { describe, test, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReaderKeyboard } from '../hooks/useReaderKeyboard';

const fireKey = (key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
};

describe('useReaderKeyboard', () => {
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
});
