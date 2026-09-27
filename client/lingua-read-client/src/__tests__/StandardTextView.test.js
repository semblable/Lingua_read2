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
  isLastBookPart: false,
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

  test('renders the Finish Book label on the last part of a book', () => {
    const props = baseProps({
      text: {
        textId: 1,
        title: 'Sample',
        content: 'Hello world',
        bookId: 42,
        structuredContent: null
      },
      isLastBookPart: true
    });
    render(<StandardTextView {...props} />);
    expect(screen.getByRole('button', { name: /Finish Book/i })).toBeInTheDocument();
  });

  test('keeps Complete Lesson for a book part until it is known to be the last one', () => {
    const props = baseProps({
      text: {
        textId: 1,
        title: 'Sample',
        content: 'Hello world',
        bookId: 42,
        structuredContent: null
      },
      isLastBookPart: false
    });
    render(<StandardTextView {...props} />);
    expect(screen.getByRole('button', { name: /Complete Lesson/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finish Book/i })).not.toBeInTheDocument();
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

  test("shows a news article's lead photo above the text without numbering it as a sentence", () => {
    // The shape the news import stores: the photo, then the paragraphs that make up content.
    const renderProcessedContentAsSentences = vi.fn((processed, startIndex) => ({
      sentenceElements: [processed],
      nextSentenceIndex: startIndex + 1
    }));
    const props = baseProps({
      text: {
        textId: 7,
        title: 'Notícia',
        content: 'Primeiro parágrafo.\n\nSegundo parágrafo.',
        bookId: null,
        structuredContent: [
          { type: 'image', imageUrl: 'epub_assets/u/news/7.jpg', caption: 'Moradores protestam em frente à câmara' },
          { type: 'paragraph', text: 'Primeiro parágrafo.' },
          { type: 'paragraph', text: 'Segundo parágrafo.' }
        ]
      },
      renderProcessedContentAsSentences
    });

    const { container } = render(<StandardTextView {...props} />);

    const photo = container.querySelector('figure.reader-image-block img');
    expect(photo).toHaveAttribute('src', '/epub_assets/u/news/7.jpg');
    expect(photo).toHaveAttribute('alt', 'Moradores protestam em frente à câmara');
    expect(screen.getByText('Moradores protestam em frente à câmara').tagName).toBe('FIGCAPTION');
    // Sentence numbering starts at the first paragraph, as it would without the photo.
    expect(renderProcessedContentAsSentences.mock.calls.map(([text, start]) => [text, start])).toEqual([
      ['Primeiro parágrafo.', 0],
      ['Segundo parágrafo.', 1]
    ]);
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
