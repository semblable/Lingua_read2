import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StandardTextView from '../components/reader/StandardTextView';

const baseSettings = {
  textSize: 16,
  readerTextAlignment: 'left',
  readerParagraphIndent: true,
  readingDensity: 'balanced'
};

const baseProps = (overrides = {}) => ({
  text: {
    textId: 1,
    title: 'Sample',
    content: 'Hello world',
    bookId: null,
    structuredContent: null
  },
  globalSettings: baseSettings,
  readingUiMode: 'classic',
  mobileReadingConfig: { lineSpacing: 1.5, blockPadding: '12px', chunkSize: 3 },
  getFontFamilyForList: () => 'sans-serif',
  handleWordSelection: vi.fn(),
  processTextContent: (text) => text,
  renderProcessedContentAsSentences: (processed) => ({
    sentenceElements: [processed],
    nextSentenceIndex: 1
  }),
  isMobile: false,
  textContentRef: { current: null },
  canUseSentenceTts: true,
  isSpeakingSentence: false,
  sentenceTtsEnabled: false,
  setSentenceTtsEnabled: vi.fn(),
  sentenceTtsRate: 1.0,
  setSentenceTtsRate: vi.fn(),
  onSpeakSentence: vi.fn(),
  handleCompleteLesson: vi.fn(),
  completing: false,
  nextTextId: null,
  ...overrides
});

describe('StandardTextView', () => {
  test('returns null when text content is null', () => {
    const { container } = render(<StandardTextView {...baseProps({ text: null })} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders the Complete Lesson button when there is content', () => {
    render(<StandardTextView {...baseProps()} />);
    expect(screen.getByRole('button', { name: /Complete Lesson/i })).toBeInTheDocument();
  });

  test('renders the Finish Book label when nextTextId is null and the text belongs to a book', () => {
    const props = baseProps({
      text: {
        textId: 1,
        title: 'Sample',
        content: 'Hello world',
        bookId: 42,
        structuredContent: null
      },
      nextTextId: null
    });
    render(<StandardTextView {...props} />);
    expect(screen.getByRole('button', { name: /Finish Book/i })).toBeInTheDocument();
  });

  test('calls handleCompleteLesson when the complete button is clicked', () => {
    const handleCompleteLesson = vi.fn();
    render(<StandardTextView {...baseProps({ handleCompleteLesson })} />);
    fireEvent.click(screen.getByRole('button', { name: /Complete Lesson/i }));
    expect(handleCompleteLesson).toHaveBeenCalledTimes(1);
  });

  test('disables the complete button while completing', () => {
    render(<StandardTextView {...baseProps({ completing: true })} />);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
  });

  test('renders TTS controls only when sentenceTtsEnabled is true', () => {
    const { rerender } = render(<StandardTextView {...baseProps({ sentenceTtsEnabled: false })} />);
    expect(screen.queryByRole('button', { name: /Speak Sentence/i })).not.toBeInTheDocument();

    rerender(<StandardTextView {...baseProps({ sentenceTtsEnabled: true })} />);
    expect(screen.getByRole('button', { name: /Speak Sentence/i })).toBeInTheDocument();
    expect(screen.getByText(/Rate: 1\.0x/)).toBeInTheDocument();
  });

  test('clicking Speak Sentence invokes onSpeakSentence', () => {
    const onSpeakSentence = vi.fn();
    render(
      <StandardTextView
        {...baseProps({ sentenceTtsEnabled: true, onSpeakSentence })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Speak Sentence/i }));
    expect(onSpeakSentence).toHaveBeenCalledTimes(1);
  });
});
