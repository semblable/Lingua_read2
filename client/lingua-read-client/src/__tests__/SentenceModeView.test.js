import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import SentenceModeView from '../components/reader/SentenceModeView';

const baseProps = (overrides = {}) => ({
  currentSegment: { type: 'paragraph', text: 'The quick brown fox', index: 0 },
  segmentCount: 5,
  currentSegmentIndex: 1,
  creditedSegmentCount: 0,
  fontStyle: { fontSize: 16 },
  processTextContent: (text) => text,
  handleWordSelection: vi.fn(),
  textContentRef: { current: null },
  canGoPrev: true,
  canGoNext: true,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onReplayAudio: vi.fn(),
  canUseSentenceTts: true,
  isSpeakingSentence: false,
  sentenceTtsEnabled: false,
  setSentenceTtsEnabled: vi.fn(),
  sentenceTtsRate: 1.0,
  setSentenceTtsRate: vi.fn(),
  isAudioLesson: false,
  sentenceAudioRepeats: 1,
  setSentenceAudioRepeats: vi.fn(),
  onShowTranslation: vi.fn(),
  onShowExplanation: vi.fn(),
  isTranslatingSegment: false,
  isExplainingSegment: false,
  isTranslationVisible: false,
  isExplanationVisible: false,
  currentSegmentTranslation: '',
  currentSegmentExplanation: '',
  ...overrides
});

describe('SentenceModeView', () => {
  test('renders a fallback message when currentSegment is null', () => {
    render(<SentenceModeView {...baseProps({ currentSegment: null })} />);
    expect(screen.getByText(/No sentence available/i)).toBeInTheDocument();
  });

  test('renders the current sentence text and position counter', () => {
    render(<SentenceModeView {...baseProps()} />);
    expect(screen.getByText('The quick brown fox')).toBeInTheDocument();
    expect(screen.getByText('2 / 5')).toBeInTheDocument(); // 1-indexed display
  });

  test('Prev and Next buttons invoke their callbacks', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<SentenceModeView {...baseProps({ onPrev, onNext })} />);
    fireEvent.click(screen.getByRole('button', { name: /Previous/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  test('Prev and Next buttons disable based on canGoPrev / canGoNext', () => {
    render(<SentenceModeView {...baseProps({ canGoPrev: false, canGoNext: false })} />);
    expect(screen.getByRole('button', { name: /Previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled();
  });

  test('Show Translation toggles label between hidden and visible states', () => {
    const onShowTranslation = vi.fn();
    const { rerender } = render(
      <SentenceModeView
        {...baseProps({ onShowTranslation, isTranslationVisible: false })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Show Translation/i }));
    expect(onShowTranslation).toHaveBeenCalledTimes(1);

    rerender(
      <SentenceModeView
        {...baseProps({
          onShowTranslation,
          isTranslationVisible: true,
          currentSegmentTranslation: 'translated text'
        })}
      />
    );
    expect(screen.getByRole('button', { name: /Hide Translation/i })).toBeInTheDocument();
    expect(screen.getByText('translated text')).toBeInTheDocument();
  });

  test('renders audio repeat controls when isAudioLesson is true', () => {
    render(<SentenceModeView {...baseProps({ isAudioLesson: true, sentenceAudioRepeats: 2 })} />);
    expect(screen.getByText(/Repeats: 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replay Audio/i })).toBeInTheDocument();
  });
});
