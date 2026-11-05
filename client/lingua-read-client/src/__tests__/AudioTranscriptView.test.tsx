import React from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AudioTranscriptView from '../components/reader/AudioTranscriptView';
import { getInitialSettings, type Settings } from '../contexts/SettingsContext';

// Exercise react-window's real row measurement rather than mocking the List.
class TestResizeObserver {
  static instances = new Set<TestResizeObserver>();
  targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) { TestResizeObserver.instances.add(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); TestResizeObserver.instances.delete(this); }
  static resize(target: Element, height: number, width = 800) {
    for (const observer of TestResizeObserver.instances) {
      if (observer.targets.has(target)) {
        const sizes = [{ blockSize: height, inlineSize: width }];
        observer.callback([{
          target,
          contentRect: new DOMRect(0, 0, width, height),
          borderBoxSize: sizes,
          contentBoxSize: sizes,
          devicePixelContentBoxSize: sizes
        }], observer as unknown as ResizeObserver);
      }
    }
  }
}

const lines = [
  { id: 1, startTime: 0, endTime: 2, text: 'A long subtitle that wraps onto several lines in a narrow reading column.' },
  { id: 2, startTime: 2, endTime: 4, text: 'The following subtitle.' }
];
const stylesheetText = readFileSync('src/pages/TextDisplay.css', 'utf8');
let stylesheet: HTMLStyleElement;

const renderTranscript = (settings: Settings, isMobile = false, overrides: Partial<React.ComponentProps<typeof AudioTranscriptView>> = {}) => render(
  <AudioTranscriptView
    isMobile={isMobile}
    srtLines={lines}
    currentSrtLineId={null}
    getFontStyling={lineSpacing => ({ fontSize: `${settings.textSize}px`, lineHeight: lineSpacing, fontFamily: 'serif' })}
    handleLineClick={vi.fn()}
    handleWordSelection={vi.fn()}
    processTextContent={text => text}
    globalSettings={settings}
    mobileReadingConfig={{ lineSpacing: 1.65, blockPadding: '0.65rem 0.75rem' }}
    textContentRef={{ current: null }}
    readingContainerRef={{ current: document.createElement('div') }}
    listRef={{ current: null }}
    languageCode="en"
    {...overrides}
  />
);

describe('audio transcript layout', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
    stylesheet = document.createElement('style');
    stylesheet.textContent = stylesheetText;
    document.head.appendChild(stylesheet);
  });
  afterEach(() => {
    cleanup();
    stylesheet.remove();
    TestResizeObserver.instances.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test.each([false, true])('centers sentence-sized lines without indentation or automatic hyphenation (mobile=%s)', isMobile => {
    renderTranscript({ ...getInitialSettings(), textSize: 24, readerContentWidth: 620,
      readerParagraphIndent: true, paragraphSpacing: 1.6 }, isMobile);
    const paragraph = screen.getByText(lines[0].text).closest('.transcript-paragraph')!;
    const style = window.getComputedStyle(paragraph);
    expect(style.maxWidth).toBe('620px');
    expect(style.width).toBe('100%');
    expect(style.marginLeft).toBe('auto');
    expect(style.marginRight).toBe('auto');
    expect(style.textIndent).toBe('0px');
    expect(style.fontSize).toBe('24px');
    expect(style.overflowWrap).toBe('break-word');
    expect(style.hyphens).toBe('none');
    expect(window.getComputedStyle(paragraph.parentElement!).paddingBottom).toBe('13.44px');
  });

  test('wrapped row heights determine where the next subtitle starts', () => {
    const { container } = renderTranscript(getInitialSettings());
    const first = container.querySelector('[data-react-window-index="0"]')!;
    const second = container.querySelector('[data-react-window-index="1"]') as HTMLElement;
    expect(first).not.toBeNull();
    act(() => { TestResizeObserver.resize(first, 180); });
    expect(second.style.transform).toBe('translateY(180px)');
    act(() => { TestResizeObserver.resize(first, 260); });
    expect(second.style.transform).toBe('translateY(260px)');
  });

  test.each([false, true])('joins cues into a sentence and highlights/seeks the original timed phrase (mobile=%s)', isMobile => {
    const seek = vi.fn();
    const groupedLines = [
      { id: 1, startTime: 0, endTime: 2, text: 'A sentence' },
      { id: 2, startTime: 2, endTime: 4, text: 'continues here.' },
      { id: 3, startTime: 4, endTime: 6, text: 'The next sentence.' }
    ];
    const { container } = renderTranscript(getInitialSettings(), isMobile, {
      srtLines: groupedLines, currentSrtLineId: 2, handleLineClick: seek
    });
    const paragraphs = container.querySelectorAll('.transcript-paragraph');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('A sentence continues here.');
    const activeCue = screen.getByText('continues here.');
    expect(activeCue.tagName).toBe('SPAN');
    expect(activeCue).toHaveClass('active-srt-line');
    expect(activeCue).toHaveAttribute('aria-current', 'true');
    expect(container.querySelectorAll('.active-srt-line')).toHaveLength(1);
    fireEvent.click(activeCue);
    expect(seek).toHaveBeenCalledWith(2);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(activeCue);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(activeCue);
    expect(seek).toHaveBeenCalledTimes(1);
    selection.removeAllRanges();
  });

  test('scrolling to a distant cue addresses its sentence group rather than its original cue index', () => {
    const manyLines = Array.from({ length: 80 }, (_, index) => ({
      id: index + 1, startTime: index * 2, endTime: index * 2 + 2,
      text: index % 2 === 0 ? 'A sentence' : 'continues here.'
    }));
    const listRef: React.RefObject<import('react-window').ListImperativeAPI | null> = { current: null };
    renderTranscript(getInitialSettings(), false, { srtLines: manyLines, listRef });
    const scroll = vi.spyOn(listRef.current!.element!, 'scrollTo').mockImplementation(() => {});
    act(() => { listRef.current!.scrollToRow({ index: 79, align: 'center' }); });
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }));
  });
});
