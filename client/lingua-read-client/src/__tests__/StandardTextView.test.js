import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import StandardTextView from '../components/reader/StandardTextView';
import { splitTextIntoSentenceSegments } from '../utils/readerText';

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
  renderSentence: (processed) => processed,
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
  test.each([
    ['zh', '第一句。第二句！第三句？'],
    ['ja', '日本語です。次の文です！'],
    ['ar', 'مرحبا بالعالم؟ نعم. جملة أخرى!'],
    ['ru', 'Первое предложение. Второе предложение!'],
    ['en', 'I met Mr. Smith today. Next sentence.'],
  ])('uses the sentence-mode boundaries and indices for %s', (code, content) => {
    const text = { textId: 1, content, languageCode: code };
    const canonical = splitTextIntoSentenceSegments(content, [], null, code);
    const { container } = render(<StandardTextView {...baseProps({
      text,
      renderSentence: (processed, index) => <span key={index} data-sentence-index={index}>{processed}</span>,
    })} />);
    const sentences = [...container.querySelectorAll('[data-sentence-index]')];
    expect(sentences.map(el => el.textContent)).toEqual(canonical.map(s => s.text));
    expect(sentences.map(el => Number(el.dataset.sentenceIndex))).toEqual(canonical.map(s => s.index));
    expect(container.querySelector('.text-content').textContent).toBe(content);
    expect(sentences.length).toBeGreaterThan(1);
  });

  test('a multi-line title occupies one shared sentence index and images occupy none', () => {
    const text = { textId: 1, content: 'Title\nSubtitle\n\nFirst sentence. Next sentence.', structuredContent: [
      { type: 'title', text: 'Title\nSubtitle' },
      { type: 'image', imageUrl: '/cover.jpg' },
      { type: 'paragraph', text: 'First sentence. Next sentence.' },
    ] };
    const canonical = splitTextIntoSentenceSegments(text.content, text.structuredContent, null, 'en');
    const renderSentence = vi.fn((processed, index) => <span key={index} data-sentence-index={index}>{processed}</span>);
    const { container } = render(<StandardTextView {...baseProps({ text, renderSentence })} />);
    expect([...container.querySelectorAll('[data-sentence-index]')].map(el => Number(el.dataset.sentenceIndex)))
      .toEqual(canonical.map(s => s.index));
    expect(container.querySelector('[data-sentence-index="0"]')).toHaveTextContent('TitleSubtitle');
  });
  test('applies the saved script direction to content without reversing controls', () => {
    const { container, rerender } = render(<StandardTextView {...baseProps({ rightToLeft: true })} />);
    expect(container.querySelector('.text-content')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: /Complete Lesson/i }).closest('[dir="rtl"]')).toBeNull();
    rerender(<StandardTextView {...baseProps({ rightToLeft: false })} />);
    expect(container.querySelector('.text-content')).toHaveAttribute('dir', 'ltr');
  });

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
    const renderSentence = vi.fn((processed) => processed);
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
      renderSentence
    });

    const { container } = render(<StandardTextView {...props} />);

    const photo = container.querySelector('figure.reader-image-block img');
    expect(photo).toHaveAttribute('src', '/epub_assets/u/news/7.jpg');
    expect(photo).toHaveAttribute('alt', 'Moradores protestam em frente à câmara');
    expect(screen.getByText('Moradores protestam em frente à câmara').tagName).toBe('FIGCAPTION');
    // Sentence numbering starts at the first paragraph, as it would without the photo.
    expect(renderSentence.mock.calls.map(([text, start]) => [text, start])).toEqual([
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
