import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import WordInfoPanel from '../components/reader/WordInfoPanel';

const baseProps = (overrides = {}) => ({
  displayedWord: { term: 'gato', wordId: 11, status: 2, isNew: false },
  selectedWord: 'gato',
  saveSuccess: false,
  translation: {
    value: 'cat',
    setValue: vi.fn(),
    onKeyDown: vi.fn(),
    isTranslating: false,
    error: null
  },
  speech: {
    sentenceTtsEnabled: false,
    canUseSentenceTts: true,
    isSpeakingWord: false,
    onSpeakWord: vi.fn()
  },
  actions: {
    onSaveWord: vi.fn(),
    processingWord: false
  },
  bookmark: {
    isSentenceBookmarked: false,
    onToggleBookmark: vi.fn()
  },
  language: {
    languageConfig: null,
    setEmbeddedUrl: vi.fn()
  },
  ...overrides
});

describe('WordInfoPanel', () => {
  test('named status controls remain usable while translation is pending and character shortcuts are off', () => {
    const props = baseProps();
    props.translation.isTranslating = true;
    render(<WordInfoPanel {...props} characterShortcutsEnabled={false} />);
    const familiar = screen.getByRole('button', { name: 'Familiar (3)' });
    expect(familiar).toBeEnabled();
    expect(familiar).toHaveAttribute('title', 'Familiar');
    fireEvent.click(familiar);
    expect(props.actions.onSaveWord).toHaveBeenCalledWith(3);
  });
  test('renders a placeholder when no word is displayed', () => {
    render(<WordInfoPanel {...baseProps({ displayedWord: null })} />);
    expect(screen.getByText(/Click\/hover on a word/i)).toBeInTheDocument();
    expect(screen.getByText(/press 1–5 to set its status/)).toBeInTheDocument();
  });

  test('renders the term and current status label', () => {
    render(<WordInfoPanel {...baseProps()} />);
    expect(screen.getByRole('heading', { name: 'gato' })).toBeInTheDocument();
    expect(screen.getByText('Learning')).toBeInTheDocument();
  });

  test('marks the current status button as pressed', () => {
    const { rerender } = render(<WordInfoPanel {...baseProps()} />);
    const pressed = screen.getAllByRole('button', { pressed: true })
      .filter(b => b.closest('[aria-label="Word status"]'));
    expect(pressed.map(b => b.textContent)).toEqual(['2']);
    expect(screen.getByRole('button', { name: /^Ignore$/ })).toHaveAttribute('aria-pressed', 'false');

    rerender(<WordInfoPanel {...baseProps({ displayedWord: { term: 'gato', wordId: 11, status: 6 } })} />);
    expect(screen.getByText('Ignored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ignore$/ })).toHaveAttribute('aria-pressed', 'true');

    rerender(<WordInfoPanel {...baseProps({ displayedWord: { term: 'gato', status: 0, isNew: true } })} />);
    expect(screen.getByText('Untracked')).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { pressed: true })
      .filter(b => b.closest('[aria-label="Word status"]'))).toHaveLength(0);
  });

  test('warns about a translation edit that is not saved yet', () => {
    const translation = (value, saved) => ({
      value, saved, setValue: vi.fn(), onKeyDown: vi.fn(), isTranslating: false, error: null
    });
    const { rerender } = render(<WordInfoPanel {...baseProps({ translation: translation('cat', 'cat') })} />);
    expect(screen.queryByText(/Translation not saved yet/)).not.toBeInTheDocument();

    rerender(<WordInfoPanel {...baseProps({ translation: translation('kitten', 'cat') })} />);
    expect(screen.getByText(/Translation not saved yet/)).toBeInTheDocument();

    // An untracked word has nothing saved; the hint says how to save it instead.
    rerender(
      <WordInfoPanel
        {...baseProps({
          displayedWord: { term: 'gato', status: 0, isNew: true },
          translation: translation('cat', undefined)
        })}
      />
    );
    expect(screen.queryByText(/Translation not saved yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
  });

  test('offers a Save button only while the box holds something unsaved', () => {
    const onSaveTranslation = vi.fn();
    const translation = (value, saved, extra = {}) => ({
      value, saved, setValue: vi.fn(), onKeyDown: vi.fn(), isTranslating: false, error: null, ...extra
    });
    const actions = (extra = {}) => ({
      onSaveWord: vi.fn(), onSaveTranslation, processingWord: false, ...extra
    });
    const { rerender } = render(
      <WordInfoPanel {...baseProps({ translation: translation('cat', 'cat'), actions: actions() })} />
    );
    expect(screen.queryByRole('button', { name: /^Save$/ })).not.toBeInTheDocument();

    rerender(<WordInfoPanel {...baseProps({ translation: translation('cat, kitten', 'cat'), actions: actions() })} />);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    expect(onSaveTranslation).toHaveBeenCalledTimes(1);

    rerender(
      <WordInfoPanel
        {...baseProps({ translation: translation('cat, kitten', 'cat'), actions: actions({ processingWord: true }) })}
      />
    );
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();

    rerender(
      <WordInfoPanel
        {...baseProps({ translation: translation('cat, kitten', 'cat', { isTranslating: true }), actions: actions() })}
      />
    );
    expect(screen.getByRole('button', { name: /^Save$/ })).toBeDisabled();

    // An untracked word with text saves as New.
    rerender(
      <WordInfoPanel
        {...baseProps({
          displayedWord: { term: 'gato', status: 0, isNew: true },
          translation: translation('cat', undefined),
          actions: actions()
        })}
      />
    );
    expect(screen.getByRole('button', { name: /^Save$/ })).toHaveAttribute('title', expect.stringMatching(/as New/));
  });

  test('renders five status buttons and invokes onSaveWord with the chosen status', () => {
    const onSaveWord = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          actions: { onSaveWord, processingWord: false }
        })}
      />
    );
    const statusButtons = screen.getAllByRole('button').filter(b => /^[1-5]$/.test(b.textContent));
    expect(statusButtons).toHaveLength(5);
    fireEvent.click(statusButtons[2]);
    expect(onSaveWord).toHaveBeenCalledWith(3);
  });

  test('renders an Ignore button that invokes onSaveWord with status 6', () => {
    const onSaveWord = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          actions: { onSaveWord, processingWord: false }
        })}
      />
    );
    const ignoreBtn = screen.getByRole('button', { name: /^Ignore$/ });
    fireEvent.click(ignoreBtn);
    expect(onSaveWord).toHaveBeenCalledWith(6);
  });

  test('typing into the translation textarea calls setValue', () => {
    const setValue = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          translation: {
            value: 'cat',
            setValue,
            onKeyDown: vi.fn(),
            isTranslating: false,
            error: null
          }
        })}
      />
    );
    const textarea = screen.getByPlaceholderText(/Translation\/Notes/);
    fireEvent.change(textarea, { target: { value: 'gatito' } });
    expect(setValue).toHaveBeenCalledWith('gatito');
  });

  test('shows a saved indicator when saveSuccess is true', () => {
    render(<WordInfoPanel {...baseProps({ saveSuccess: true })} />);
    expect(screen.getByText('✓ Saved')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('does not expose a separate sentence-mining step', () => {
    render(<WordInfoPanel {...baseProps()} />);
    expect(screen.queryByRole('button', { name: /Mine/ })).not.toBeInTheDocument();
  });

  test('definition tools precede grading and the sentence bookmark stays in the header', () => {
    const onRetranslateWithContext = vi.fn();
    const { container } = render(<WordInfoPanel {...baseProps({ actions: {
      onSaveWord: vi.fn(), processingWord: false, onRetranslateWithContext, canRetranslate: true,
      onAddTranslationWithContext: vi.fn(), canAddTranslation: true,
    } })} />);
    const translate = screen.getByRole('button', { name: 'AI Translate' });
    const grade = screen.getByRole('button', { name: 'Learning (2)' });
    expect(translate.compareDocumentPosition(grade) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(translate.closest('.word-info-definition')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Bookmark sentence' }).closest('.word-info-header')).not.toBeNull();
    expect(container.querySelector('.word-info-status-pill')).toBeNull();
    expect(screen.getAllByText('Learning')).toHaveLength(1);
    fireEvent.click(translate);
    expect(onRetranslateWithContext).toHaveBeenCalledOnce();
  });

  test('the definition starts at two rows without taking focus and expands for longer notes', () => {
    const props = baseProps();
    const { rerender } = render(<WordInfoPanel {...props} />);
    const textarea = screen.getByRole('textbox', { name: 'Translation' });
    expect(textarea).toHaveAttribute('rows', '2');
    expect(textarea).not.toHaveFocus();
    const shortHeight = parseFloat(textarea.style.height);
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 140 });
    rerender(<WordInfoPanel {...props} translation={{ ...props.translation, value: 'A much longer definition with multiple senses and notes.' }} />);
    expect(parseFloat(textarea.style.height)).toBeGreaterThan(shortHeight);
    expect(parseFloat(textarea.style.height)).toBeGreaterThanOrEqual(140);
  });

  test('keeps a manually chosen definition height while editing and resets it for another word', () => {
    const props = baseProps();
    const { rerender } = render(<WordInfoPanel {...props} />);
    const textarea = screen.getByRole('textbox', { name: 'Translation' });
    textarea.style.height = '180px';
    rerender(<WordInfoPanel {...props} translation={{ ...props.translation, value: 'kitten' }} />);
    expect(parseFloat(textarea.style.height)).toBe(180);
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 220 });
    rerender(<WordInfoPanel {...props} translation={{ ...props.translation, value: 'An extended definition' }} />);
    expect(parseFloat(textarea.style.height)).toBe(180);
    textarea.style.height = '96px';
    rerender(<WordInfoPanel {...props} translation={{ ...props.translation, value: 'An extended definition with another note' }} />);
    expect(parseFloat(textarea.style.height)).toBe(96);
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 20 });
    rerender(<WordInfoPanel {...props} displayedWord={{ term: 'cão', status: 0 }} translation={{ ...props.translation, value: 'dog' }} />);
    expect(parseFloat(textarea.style.height)).toBeLessThan(180);
  });

  test.each([
    ['pt', 'algarve', 'Algarve'],
    ['pt', 'café', 'cafe\u0301'],
    ['tr', 'ışık', 'IŞIK'],
    ['fr', "l'homme", 'l’homme'],
  ])('does not offer to save an equivalent %s spelling separately', (code, term, surface) => {
    const props = baseProps();
    render(<WordInfoPanel {...props}
      displayedWord={{ term, surface, status: 2, wordId: 11 }}
      language={{ ...props.language, languageConfig: { code } }}
      actions={{ ...props.actions, onSaveExactForm: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: /Save exact form/ })).not.toBeInTheDocument();
  });

  test.each([
    ['ko', '책', '책을'],
    ['ko-KR', '책'.normalize('NFD'), '책을'],
    ['KO_kr', '책', '책을'.normalize('NFD')],
  ])('allows a recognized Korean form to be tracked separately (%s)', (code, term, surface) => {
    const props = baseProps();
    const onSaveExactForm = vi.fn();
    render(<WordInfoPanel {...props}
      displayedWord={{ term, surface, status: 3, wordId: 11,
        lemmaCandidates: [{ lemma: '책', particle: '을', particleType: 'Object Marker', dictionaryValidated: true, rank: 0 }] }}
      language={{ ...props.language, languageConfig: { code } }}
      actions={{ ...props.actions, onSaveExactForm }} />);
    const button = screen.getByRole('button', { name: `Save exact form '${surface}'` });
    expect(button).toHaveAttribute('title', `Track this form separately from '${term}', with its own word status`);
    fireEvent.click(button);
    expect(onSaveExactForm).toHaveBeenCalledOnce();
  });

  test.each([
    ['pt', 'trabalhar', 'trabalho'],
    ['en', 'go', 'went'],
    ['fr', 'homme', "l'homme"],
    ['it', 'amico', "l'amico"],
    ['ca', 'home', "l'home"],
    [undefined, '책', '책을'],
  ])('does not offer separate-form saving for an unsupported language (%s)', (code, term, surface) => {
    const props = baseProps();
    render(<WordInfoPanel {...props}
      displayedWord={{ term, surface, status: 3, wordId: 11,
        lemmaCandidates: [{ lemma: term, particle: '', particleType: '', dictionaryValidated: true, rank: 0 }] }}
      language={{ ...props.language, languageConfig: { code } }}
      actions={{ ...props.actions, onSaveExactForm: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: /Save exact form/ })).not.toBeInTheDocument();
  });

  test('Korean requires a matching base-form analysis and a distinct surface spelling', () => {
    const props = baseProps();
    const candidate = { lemma: '책', particle: '을', particleType: 'Object Marker', dictionaryValidated: true, rank: 0 };
    const renderPanel = (surface, lemmaCandidates) => <WordInfoPanel {...props}
      displayedWord={{ term: '책', surface, status: 3, wordId: 11, lemmaCandidates }}
      language={{ ...props.language, languageConfig: { code: 'ko' } }}
      actions={{ ...props.actions, onSaveExactForm: vi.fn() }} />;
    const { rerender } = render(renderPanel('책을', undefined));
    expect(screen.queryByRole('button', { name: /Save exact form/ })).not.toBeInTheDocument();
    rerender(renderPanel('책을', [{ ...candidate, lemma: '집' }]));
    expect(screen.queryByRole('button', { name: /Save exact form/ })).not.toBeInTheDocument();
    rerender(renderPanel('책', [candidate]));
    expect(screen.queryByRole('button', { name: /Save exact form/ })).not.toBeInTheDocument();
    rerender(renderPanel('책'.normalize('NFD'), [candidate]));
    expect(screen.queryByRole('button', { name: /Save exact form/ })).not.toBeInTheDocument();
  });

  test('lists active term dictionaries and hides the section when there are none', () => {
    const withDictionaries = (dictionaries) => baseProps({
      language: { languageConfig: { dictionaries }, setEmbeddedUrl: vi.fn() }
    });
    const { rerender } = render(
      <WordInfoPanel
        {...withDictionaries([
          { dictionaryId: 2, isActive: true, purpose: 'terms', displayType: 'popup', urlTemplate: 'https://www.linguee.com/?q=###', sortOrder: 2 },
          { dictionaryId: 1, isActive: true, purpose: 'terms', displayType: 'popup', urlTemplate: 'https://www.wordreference.com/es/###', sortOrder: 1 },
          { dictionaryId: 3, isActive: false, purpose: 'terms', displayType: 'popup', urlTemplate: 'https://example.com/###', sortOrder: 3 },
          { dictionaryId: 4, isActive: true, purpose: 'sentences', displayType: 'popup', urlTemplate: 'https://deepl.com/###', sortOrder: 4 }
        ])}
      />
    );
    expect(screen.getByText('Dictionaries')).toBeInTheDocument();
    const names = screen.getAllByRole('button').map(b => b.textContent.replace(' ↗', ''));
    expect(names.filter(n => ['Wordreference', 'Linguee', 'Example', 'Deepl'].includes(n)))
      .toEqual(['Wordreference', 'Linguee']);

    rerender(
      <WordInfoPanel
        {...withDictionaries([
          { dictionaryId: 4, isActive: true, purpose: 'sentences', displayType: 'popup', urlTemplate: 'https://deepl.com/###', sortOrder: 1 }
        ])}
      />
    );
    expect(screen.queryByText('Dictionaries')).not.toBeInTheDocument();
  });

  test('bookmark button toggles its variant via onToggleBookmark', () => {
    const onToggleBookmark = vi.fn();
    render(
      <WordInfoPanel
        {...baseProps({
          bookmark: { isSentenceBookmarked: false, onToggleBookmark }
        })}
      />
    );
    const btn = screen.getByTitle(/Bookmark this sentence/);
    fireEvent.click(btn);
    expect(onToggleBookmark).toHaveBeenCalledTimes(1);
  });

  test('renders + Prev word and + Next word controls when phraseSelection can extend', () => {
    const onExtendPrev = vi.fn();
    const onExtendNext = vi.fn();
    const { rerender } = render(
      <WordInfoPanel
        {...baseProps({
          phraseSelection: {
            canExtendPrev: false,
            canExtendNext: true,
            onExtendPrev,
            onExtendNext
          }
        })}
      />
    );

    const prevBtn = screen.getByRole('button', { name: /Add previous word to selection/i });
    const nextBtn = screen.getByRole('button', { name: /Add next word to selection/i });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);
    expect(onExtendNext).toHaveBeenCalledTimes(1);

    rerender(
      <WordInfoPanel
        {...baseProps({
          phraseSelection: {
            canExtendPrev: false,
            canExtendNext: false,
            onExtendPrev,
            onExtendNext
          }
        })}
      />
    );
    expect(screen.queryByRole('button', { name: /Add previous word to selection/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add next word to selection/i })).not.toBeInTheDocument();
  });
});
