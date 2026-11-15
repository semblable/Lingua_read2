import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useReaderSelectionMarker } from '../hooks/useReaderSelectionMarker';

describe('persistent reader occurrence marker', () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => container.remove());

  test('marks only the inspected instance of a repeated Known word and preserves focus', async () => {
    container.innerHTML = '<span class="sentence" data-sentence-index="0"><span class="clickable-word word-status-5">dono</span> e <span class="clickable-word word-status-5">dono</span>.</span>';
    const spans = container.querySelectorAll<HTMLElement>('.clickable-word');
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const ref = { current: container };
    const { result } = renderHook(() => useReaderSelectionMarker(ref, ref));
    act(() => result.current([spans[1]]));
    expect(spans[0]).not.toHaveClass('reader-word-selected');
    expect(spans[1]).toHaveClass('reader-word-selected');
    textarea.focus();
    window.getSelection()?.removeAllRanges();
    expect(document.activeElement).toBe(textarea);
    expect(spans[1]).toHaveClass('reader-word-selected');
    // React replaces className when familiarity changes; the source occurrence stays selected.
    await act(async () => { spans[1].className = 'clickable-word word-status-3'; });
    expect(spans[1]).toHaveClass('word-status-3', 'reader-word-selected');
    textarea.remove();
  });

  test('keeps an expanded phrase selected when saving merges its word spans', async () => {
    container.innerHTML = '<span class="sentence" data-sentence-index="1"><span class="clickable-word">Hello</span> <span class="clickable-word">brave</span> <span class="clickable-word">world</span>.</span>';
    const ref = { current: container };
    const { result } = renderHook(() => useReaderSelectionMarker(ref, ref));
    act(() => result.current([...container.querySelectorAll<HTMLElement>('.clickable-word')].slice(1)));
    await act(async () => {
      container.innerHTML = '<span class="sentence" data-sentence-index="1"><span class="clickable-word">Hello</span> <span class="clickable-word word-status-2">brave world</span>.</span>';
    });
    expect(container.querySelectorAll('.reader-word-selected')).toHaveLength(1);
    expect(container.querySelector('.reader-word-selected')).toHaveTextContent('brave world');
  });

  test('restores the same cue after virtualization and ignores an identical word in another cue', async () => {
    container.innerHTML = '<span class="srt-line" id="srt-line-1"><span class="clickable-word">dono</span>.</span><span class="srt-line" id="srt-line-2"><span class="clickable-word">dono</span>.</span>';
    const ref = { current: container };
    const { result } = renderHook(() => useReaderSelectionMarker(ref, ref));
    act(() => result.current([container.querySelector<HTMLElement>('#srt-line-2 .clickable-word')!]));
    await act(async () => { container.querySelector('#srt-line-2')!.remove(); });
    expect(container.querySelectorAll('.reader-word-selected')).toHaveLength(0);
    await act(async () => {
      container.insertAdjacentHTML('beforeend', '<span class="srt-line" id="srt-line-2"><span class="clickable-word word-status-5">dono</span>.</span>');
    });
    expect(container.querySelector('#srt-line-1 .clickable-word')).not.toHaveClass('reader-word-selected');
    expect(container.querySelector('#srt-line-2 .clickable-word')).toHaveClass('reader-word-selected');
  });

  test('a sentence bookmark does not move the marker and a new passage clears it', async () => {
    container.innerHTML = '<span class="sentence" data-sentence-index="0"><span class="clickable-word">word</span>.</span>';
    const ref = { current: container };
    const firstGeneration = {};
    const { result, rerender } = renderHook(({ generation }) => useReaderSelectionMarker(ref, generation),
      { initialProps: { generation: firstGeneration } });
    act(() => result.current([container.querySelector<HTMLElement>('.clickable-word')!]));
    await act(async () => {
      container.querySelector('.sentence')!.insertAdjacentHTML('afterbegin', '<span class="bookmark-icon">🔖</span>');
    });
    expect(container.querySelector('.clickable-word')).toHaveClass('reader-word-selected');
    rerender({ generation: {} });
    expect(container.querySelector('.clickable-word')).not.toHaveClass('reader-word-selected');
  });
});
