import React from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
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

const renderTranscript = (settings: Settings, isMobile = false) => render(
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
    itemData={{ lines, currentLineId: null, processLineContent: text => text, handleLineClick: vi.fn() }}
    listRef={{ current: null }}
    languageCode="en"
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
  });

  test.each([false, true])('centers the configured column and applies typography, indentation and spacing (mobile=%s)', isMobile => {
    renderTranscript({ ...getInitialSettings(), textSize: 24, readerContentWidth: 620,
      readerParagraphIndent: true, paragraphSpacing: 1.6 }, isMobile);
    const paragraph = screen.getByText(lines[0].text);
    const style = window.getComputedStyle(paragraph);
    expect(style.maxWidth).toBe('620px');
    expect(style.width).toBe('100%');
    expect(style.marginLeft).toBe('auto');
    expect(style.marginRight).toBe('auto');
    expect(style.textIndent).toBe('36px');
    expect(style.fontSize).toBe('24px');
    expect(style.overflowWrap).toBe('anywhere');
    expect(window.getComputedStyle(paragraph.parentElement!).paddingBottom).toBe('38.4px');
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
});
