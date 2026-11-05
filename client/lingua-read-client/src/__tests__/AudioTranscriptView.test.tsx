import React from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import AudioTranscriptView from '../components/reader/AudioTranscriptView';
import { getInitialSettings, type Settings } from '../contexts/SettingsContext';
import { AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY, AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY } from '../utils/audioTranscript';

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

const virtualScrollFixture = () => {
  localStorage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, 'flow');
  let now = 0;
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  const listRef: React.RefObject<import('react-window').ListImperativeAPI | null> = { current: null };
  const manyLines = Array.from({ length: 120 }, (_, index) => ({
    id: index + 1, startTime: index * 2, endTime: index * 2 + 2, text: `Sentence ${index + 1}.`
  }));
  const view = renderTranscript(getInitialSettings(), false, { srtLines: manyLines, listRef });
  const viewport = listRef.current!.element!;
  vi.spyOn(viewport, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(viewport, 'scrollHeight', 'get').mockReturnValue(20000);
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) return new DOMRect(0, 100, 800, 600);
    if (this.classList.contains('srt-line')) {
      const row = this.closest<HTMLElement>('[data-react-window-index]')!;
      const rowTop = parseFloat(row.style.transform.replace('translateY(', ''));
      const cueIndex = Array.from(row.querySelectorAll('.srt-line')).indexOf(this);
      return new DOMRect(0, 100 + rowTop + 20 + cueIndex * 40 - viewport.scrollTop, 600, 40);
    }
    return originalRect.call(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-react-window-index') ? 200 : 0;
  });
  const scroll = vi.fn((options: ScrollToOptions) => {
    if (options.top === undefined) return;
    viewport.scrollTop = Math.max(0, Math.min(options.top, viewport.scrollHeight - viewport.clientHeight));
    fireEvent.scroll(viewport);
  });
  vi.spyOn(viewport, 'scrollTo').mockImplementation(scroll as typeof viewport.scrollTo);
  const measure = () => act(() => {
    TestResizeObserver.resize(viewport, 600);
    for (const row of viewport.querySelectorAll('[data-react-window-index]')) TestResizeObserver.resize(row, 200);
  });
  measure();
  const frame = () => {
    now += 16;
    const pending = [...frames.values()];
    frames.clear();
    act(() => { for (const callback of pending) callback(now); });
    measure();
  };
  return { ...view, viewport, listRef, scroll, frame, frames };
};

describe('audio transcript layout', () => {
  beforeEach(() => {
    localStorage.removeItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY);
    localStorage.removeItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY);
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
    localStorage.removeItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY);
    localStorage.removeItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY);
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
    expect(style.textAlign).toBe('center');
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

  test.each([
    { mobile: false, flow: false }, { mobile: true, flow: false },
    { mobile: false, flow: true }, { mobile: true, flow: true }
  ])('paragraph padding seeks once while word lookup and selection stay separate (mobile=$mobile, flow=$flow)', ({ mobile, flow }) => {
    if (flow) localStorage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, 'flow');
    const seek = vi.fn();
    const lookup = vi.fn();
    const { container } = renderTranscript(getInitialSettings(), mobile, { handleLineClick: seek,
      processTextContent: text => <span className="clickable-word" onClick={event => { event.stopPropagation(); lookup(text); }}>{text}</span> });
    const paragraph = container.querySelector('.transcript-paragraph')!;
    fireEvent.click(paragraph);
    expect(seek).toHaveBeenLastCalledWith(0);
    const secondCue = container.querySelector('#srt-line-2')!;
    fireEvent.click(secondCue);
    expect(seek).toHaveBeenLastCalledWith(2);
    expect(seek).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByText(lines[1].text));
    expect(lookup).toHaveBeenCalledWith(lines[1].text);
    expect(seek).toHaveBeenCalledTimes(2);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(secondCue);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(paragraph);
    expect(seek).toHaveBeenCalledTimes(2);
    selection.removeAllRanges();
  });

  test('a mobile swipe suppresses the following paragraph-padding click', () => {
    const seek = vi.fn();
    const { container } = renderTranscript(getInitialSettings(), true, { handleLineClick: seek });
    const transcript = container.querySelector('.audio-transcript-container')!;
    const paragraph = container.querySelector('.transcript-paragraph')!;
    fireEvent.touchStart(transcript);
    fireEvent.touchMove(transcript);
    fireEvent.touchEnd(transcript);
    fireEvent.click(paragraph);
    expect(seek).not.toHaveBeenCalled();
  });

  test.each([false, true])('flow joins sentences into paragraphs and highlights/seeks the original timed phrase (mobile=%s)', isMobile => {
    const seek = vi.fn();
    const groupedLines = [
      { id: 1, startTime: 0, endTime: 2, text: 'A sentence' },
      { id: 2, startTime: 2, endTime: 4, text: 'continues here.' },
      { id: 3, startTime: 4, endTime: 6, text: 'The next sentence.' }
    ];
    const { container } = renderTranscript(getInitialSettings(), isMobile, {
      srtLines: groupedLines, currentSrtLineId: 2, handleLineClick: seek
    });
    expect(screen.getByRole('switch', { name: 'Flowing text' })).not.toBeChecked();
    expect(container.querySelectorAll('.transcript-paragraph')).toHaveLength(3);
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    const paragraphs = container.querySelectorAll('.transcript-paragraph');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].textContent).toBe('A sentence continues here. The next sentence.');
    const activeCue = screen.getByText('continues here.');
    expect(activeCue.tagName).toBe('SPAN');
    expect(activeCue).toHaveClass('active-srt-line');
    expect(activeCue).toHaveAttribute('aria-current', 'true');
    expect(window.getComputedStyle(activeCue).boxShadow).toBe('none');
    expect(container.querySelectorAll('.active-srt-line')).toHaveLength(1);
    expect(window.getComputedStyle(screen.getByText('A sentence')).opacity).toBe('0.5');
    expect(window.getComputedStyle(activeCue).opacity).toBe('1');
    const transcript = activeCue.closest('.audio-transcript-container')!;
    expect(parseFloat((transcript as HTMLElement).style.getPropertyValue('--audio-transcript-row-gap')))
      .toBeLessThan(getInitialSettings().paragraphSpacing * 0.35);
    fireEvent.click(activeCue);
    expect(seek).toHaveBeenCalledWith(2);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(activeCue);
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent(document, new Event('selectionchange'));
    expect(transcript).toHaveClass('has-native-selection');
    const snapshot = container.cloneNode(true) as HTMLElement;
    document.body.appendChild(snapshot);
    expect(window.getComputedStyle(snapshot.querySelector('.srt-line')!).opacity).toBe('1');
    snapshot.remove();
    fireEvent.click(activeCue);
    expect(seek).toHaveBeenCalledTimes(1);
    selection.removeAllRanges();
    fireEvent(document, new Event('selectionchange'));
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    expect(container.querySelectorAll('.transcript-paragraph')).toHaveLength(3);
    expect(screen.getByText('continues here.')).toHaveAttribute('aria-current', 'true');
  });

  test('remembers the selected layout when another lesson opens', () => {
    const first = renderTranscript(getInitialSettings());
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    expect(localStorage.getItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY)).toBe('flow');
    first.unmount();
    const second = renderTranscript(getInitialSettings());
    expect(screen.getByRole('switch', { name: 'Flowing text' })).toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    second.unmount();
    renderTranscript(getInitialSettings());
    expect(screen.getByRole('switch', { name: 'Flowing text' })).not.toBeChecked();
  });

  test('flow blocks get shorter at a larger reading size', () => {
    localStorage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, 'flow');
    const continuousSpeech = Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, startTime: index * 2, endTime: index * 2 + 2,
      text: `${index} ${'palavra '.repeat(8)}`.trim()
    }));
    const small = renderTranscript({ ...getInitialSettings(), textSize: 16, readerContentWidth: 620 }, false,
      { srtLines: continuousSpeech });
    const smallCount = small.container.querySelectorAll('.transcript-paragraph').length;
    small.unmount();
    const large = renderTranscript({ ...getInitialSettings(), textSize: 32, readerContentWidth: 620 }, false,
      { srtLines: continuousSpeech });
    expect(large.container.querySelectorAll('.transcript-paragraph').length).toBeGreaterThan(smallCount);
    expect(large.container.querySelectorAll('.srt-line')).toHaveLength(continuousSpeech.length);
  });

  test.each([null, 999])('flow keeps text readable when no cue is active (id=%s)', currentSrtLineId => {
    localStorage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, 'flow');
    renderTranscript(getInitialSettings(), false, { currentSrtLineId });
    expect(window.getComputedStyle(screen.getByText(lines[0].text)).opacity).toBe('1');
  });

  test('flow context stays subdued between timed cues while playback continues', () => {
    localStorage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, 'flow');
    renderTranscript(getInitialSettings(), false, { currentSrtLineId: null, isAudioPlaying: true });
    expect(window.getComputedStyle(screen.getByText(lines[0].text)).opacity).toBe('0.5');
  });

  test.each([false, true])('remembers alignment separately for cue and flow views (mobile=%s)', isMobile => {
    const first = renderTranscript({ ...getInitialSettings(), readerTextAlignment: 'justify' }, isMobile);
    expect(screen.getByRole('button', { name: 'Center' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    expect(screen.getByRole('button', { name: 'Left' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Justify' }));
    // Use fresh markup: Happy DOM caches ancestor selector matches after class changes.
    const snapshot = first.container.cloneNode(true) as HTMLElement;
    document.body.appendChild(snapshot);
    const style = window.getComputedStyle(snapshot.querySelector('.transcript-paragraph')!);
    expect(style.textAlign).toBe('justify');
    expect(style.hyphens).toBe('none');
    snapshot.remove();
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    expect(screen.getByRole('button', { name: 'Left' })).toHaveAttribute('aria-pressed', 'true');
    first.unmount();
    renderTranscript(getInitialSettings(), isMobile);
    expect(screen.getByRole('button', { name: 'Left' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    expect(screen.getByRole('button', { name: 'Justify' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY)!)).toEqual({ cues: 'left', flow: 'justify' });
  });

  test.each(['{broken', '[]', '{"cues":"invalid","flow":"center"}'])('recovers invalid saved alignment (%s)', saved => {
    localStorage.setItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY, saved);
    renderTranscript(getInitialSettings());
    expect(screen.getByRole('button', { name: 'Center' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    expect(screen.getByRole('button', { name: saved.includes('invalid') ? 'Center' : 'Left' })).toHaveAttribute('aria-pressed', 'true');
  });

  test.each([false, true])('playback tint preserves vocabulary colours (flow=%s)', flow => {
    if (flow) localStorage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, 'flow');
    renderTranscript(getInitialSettings(), false, { currentSrtLineId: 1,
      processTextContent: text => <span style={{ backgroundColor: 'rgb(128, 64, 32)', color: 'rgb(255, 255, 255)' }}>{text}</span> });
    const word = screen.getByText(lines[0].text);
    const activeCue = word.closest('.active-srt-line')!;
    expect(window.getComputedStyle(activeCue).backgroundColor).toBe('rgba(250, 204, 72, 0.14)');
    expect(window.getComputedStyle(activeCue).boxShadow).toBe('none');
    expect(word).toHaveStyle({ backgroundColor: 'rgb(128, 64, 32)', color: 'rgb(255, 255, 255)' });
  });

  test('follows a rendered cue near the viewport centre without fighting text selection', () => {
    const listRef: React.RefObject<import('react-window').ListImperativeAPI | null> = { current: null };
    renderTranscript(getInitialSettings(), false, { listRef });
    const viewport = listRef.current!.element!;
    const cue = screen.getByText(lines[1].text);
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 800, 600));
    const position = vi.spyOn(cue, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 500, 600, 40));
    viewport.scrollTop = 200;
    const scroll = vi.spyOn(viewport, 'scrollTo').mockImplementation(() => {});
    act(() => { listRef.current!.scrollToRow({ index: 1, align: 'center' }); });
    expect(scroll).toHaveBeenLastCalledWith({ top: 320, behavior: 'smooth' });
    scroll.mockClear();
    position.mockReturnValue(new DOMRect(0, 380, 600, 40));
    act(() => { listRef.current!.scrollToRow({ index: 1, align: 'center' }); });
    expect(scroll).not.toHaveBeenCalled();
    position.mockReturnValue(new DOMRect(0, 500, 600, 40));
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: cue.firstChild } as Selection);
    act(() => { listRef.current!.scrollToRow({ index: 1, align: 'center' }); });
    expect(scroll).not.toHaveBeenCalled();
  });

  test('scrolling to a distant cue addresses its sentence group rather than its original cue index', () => {
    const manyLines = Array.from({ length: 80 }, (_, index) => ({
      id: index + 1, startTime: index * 2, endTime: index * 2 + 2,
      text: index % 2 === 0 ? 'A sentence' : 'continues here.'
    }));
    const listRef: React.RefObject<import('react-window').ListImperativeAPI | null> = { current: null };
    renderTranscript(getInitialSettings(), false, { srtLines: manyLines, listRef });
    fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    const scroll = vi.spyOn(listRef.current!.element!, 'scrollTo').mockImplementation(() => {});
    act(() => { listRef.current!.scrollToRow({ index: 79, align: 'center' }); });
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }));
  });

  test('an offscreen flow cue stays centred after virtual rows are measured and animation frames settle', () => {
    const { listRef, viewport, scroll, frame, frames } = virtualScrollFixture();
    expect(document.getElementById('srt-line-84')).toBeNull();
    act(() => { listRef.current!.scrollToRow({ index: 83, align: 'center' }); });
    for (let index = 0; index < 90; index++) frame();
    const cue = document.getElementById('srt-line-84')!;
    expect(cue).not.toBeNull();
    const cueRect = cue.getBoundingClientRect();
    const bounds = viewport.getBoundingClientRect();
    expect(cueRect.top + cueRect.height / 2).toBeCloseTo(bounds.top + bounds.height / 2);
    expect(scroll.mock.calls.some(([options]) => typeof options === 'object' && options.behavior === 'smooth')).toBe(true);
    expect(frames.size).toBe(0);
    const settledTop = viewport.scrollTop;
    for (let index = 0; index < 10; index++) frame();
    expect(viewport.scrollTop).toBe(settledTop);
  });

  test.each(['wheel', 'pointerdown', 'touchstart', 'keydown', 'selection', 'layout', 'unmount'])('a pending offscreen follow yields to %s', action => {
    const { listRef, viewport, scroll, frame, unmount } = virtualScrollFixture();
    act(() => { listRef.current!.scrollToRow({ index: 83, align: 'center' }); });
    if (action === 'unmount') unmount();
    else if (action === 'layout') fireEvent.click(screen.getByRole('switch', { name: 'Flowing text' }));
    else if (action === 'selection') vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, anchorNode: viewport } as unknown as Selection);
    else if (action === 'keydown') fireEvent.keyDown(viewport, { key: 'PageDown' });
    else fireEvent(viewport, new Event(action, { bubbles: true }));
    scroll.mockClear();
    for (let index = 0; index < 90; index++) frame();
    expect(scroll).not.toHaveBeenCalled();
  });

  test('an active selection blocks the initial offscreen jump', () => {
    const { listRef, viewport, scroll } = virtualScrollFixture();
    vi.spyOn(window, 'getSelection').mockReturnValue({ isCollapsed: false, focusNode: viewport } as unknown as Selection);
    act(() => { listRef.current!.scrollToRow({ index: 83, align: 'center' }); });
    expect(scroll).not.toHaveBeenCalled();
  });

  test.each([0, 2])('blank subtitle cues do not start a virtual scroll loop (index=%s)', index => {
    const listRef: React.RefObject<import('react-window').ListImperativeAPI | null> = { current: null };
    renderTranscript(getInitialSettings(), false, { listRef, srtLines: [
      { id: 1, startTime: 0, endTime: 1, text: ' ' },
      { id: 2, startTime: 1, endTime: 2, text: 'A visible cue.' },
      { id: 3, startTime: 2, endTime: 3, text: '' }
    ] });
    const scroll = vi.spyOn(listRef.current!.element!, 'scrollTo');
    act(() => { listRef.current!.scrollToRow({ index, align: 'center' }); });
    expect(scroll).not.toHaveBeenCalled();
  });
});
