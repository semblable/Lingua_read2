import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({
  translateText: vi.fn(),
  translateSelectionWithContext: vi.fn()
}));

import { translateText, translateSelectionWithContext } from '../utils/api';
import { useWordTranslation } from '../hooks/useWordTranslation';

const baseText = {
  textId: 1,
  languageCode: 'es',
  content: 'hola',
  languageId: 5
};

const baseSettings = {
  autoTranslateWords: true,
  translationTargetLanguageCode: 'EN'
};

const renderTranslationHook = (overrides = {}) => {
  const applyTranslationToDisplayedWord = vi.fn();
  const args = {
    text: overrides.text === undefined ? baseText : overrides.text,
    globalSettings: { ...baseSettings, ...overrides.globalSettings },
    targetLanguageCode: overrides.targetLanguageCode ?? 'EN',
    applyTranslationToDisplayedWord
  };
  const view = renderHook((props) => useWordTranslation(props), { initialProps: args });
  return { ...view, applyTranslationToDisplayedWord };
};

describe('useWordTranslation', () => {
  beforeEach(() => {
    translateText.mockReset();
    translateSelectionWithContext.mockReset();
  });

  test('triggerAutoTranslation returns early when text is null', async () => {
    const { result } = renderTranslationHook({ text: null });
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).not.toHaveBeenCalled();
  });

  test('triggerAutoTranslation returns early when auto-translate is disabled and not forced', async () => {
    const { result } = renderTranslationHook({
      globalSettings: { autoTranslateWords: false }
    });
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).not.toHaveBeenCalled();
  });

  test('triggerAutoTranslation fetches and stores a translation', async () => {
    translateText.mockResolvedValue({ translatedText: 'hello' });
    const { result, applyTranslationToDisplayedWord } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).toHaveBeenCalledWith('hola', 'es', 'EN', expect.any(Object));
    expect(result.current.translation).toBe('hello');
    expect(applyTranslationToDisplayedWord).toHaveBeenCalledWith('hola', 'hello');
  });

  test('second trigger for the same term hits the cache (no second API call)', async () => {
    translateText.mockResolvedValue({ translatedText: 'hello' });
    const { result } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(result.current.translation).toBe('hello');
  });

  test('surfaces a clear rate-limit message on 429', async () => {
    translateText.mockRejectedValue({ status: 429, message: 'rate limit' });
    const { result } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(result.current.wordTranslationError).toMatch(/rate limit/i);
  });

  test('does not surface error when the request is aborted', async () => {
    translateText.mockRejectedValue({ name: 'AbortError' });
    const { result } = renderTranslationHook();
    await act(async () => {
      await result.current.triggerAutoTranslation('hola');
    });
    expect(result.current.wordTranslationError).toBe('');
  });

  test('appendAutoTranslation merges a new context-aware translation with the existing one', async () => {
    translateSelectionWithContext.mockResolvedValueOnce({ translatedText: 'apple' });
    const { result, applyTranslationToDisplayedWord } = renderTranslationHook();
    act(() => {
      result.current.setTranslation('fruit');
    });
    let returned;
    await act(async () => {
      returned = await result.current.appendAutoTranslation('manzana', { sentenceContext: 'Una manzana roja' });
    });
    await waitFor(() => {
      expect(result.current.translation).toBe('fruit, apple');
    });
    // The caller saves this text, so it must match what the box now shows.
    expect(returned).toBe('fruit, apple');
    expect(applyTranslationToDisplayedWord).toHaveBeenCalledWith('manzana', 'fruit, apple');
  });

  test('appendAutoTranslation skips duplicate context translations', async () => {
    translateSelectionWithContext.mockResolvedValueOnce({ translatedText: 'apple' });
    const { result, applyTranslationToDisplayedWord } = renderTranslationHook();
    act(() => {
      result.current.setTranslation('apple');
    });
    let returned;
    await act(async () => {
      returned = await result.current.appendAutoTranslation('manzana', { sentenceContext: 'Una manzana' });
    });
    await waitFor(() => {
      expect(result.current.translation).toBe('apple');
    });
    expect(returned).toBeNull();
    expect(applyTranslationToDisplayedWord).not.toHaveBeenCalled();
  });

  test('appendAutoTranslation ignores a response that lands after cancelInflight', async () => {
    let resolveRequest;
    translateSelectionWithContext.mockImplementation(() => new Promise(resolve => { resolveRequest = resolve; }));
    const { result, applyTranslationToDisplayedWord } = renderTranslationHook();
    act(() => {
      result.current.setTranslation('fruit');
    });
    let pending;
    act(() => {
      pending = result.current.appendAutoTranslation('manzana', { sentenceContext: 'Una manzana' });
    });
    expect(result.current.isTranslating).toBe(true);

    act(() => {
      result.current.cancelInflight();
    });
    // Nothing else will clear the flag: the cancelled request no longer owns it.
    expect(result.current.isTranslating).toBe(false);

    let returned;
    await act(async () => {
      resolveRequest({ translatedText: 'apple' });
      returned = await pending;
    });
    expect(returned).toBeNull();
    expect(result.current.translation).toBe('fruit');
    expect(applyTranslationToDisplayedWord).not.toHaveBeenCalled();
  });

  test('cancelInflight aborts the in-flight request', async () => {
    let observedSignal = null;
    translateText.mockImplementation((_term, _src, _tgt, opts) => {
      observedSignal = opts?.signal;
      return new Promise(() => {});
    });
    const { result } = renderTranslationHook();
    act(() => {
      result.current.triggerAutoTranslation('hola');
    });
    expect(observedSignal?.aborted).toBe(false);
    act(() => {
      result.current.cancelInflight();
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  test('word mode with sentenceContext calls translateText (not AI) and caches per sentence for DeepL', async () => {
    translateText
      .mockResolvedValueOnce({ translatedText: 'bank' })
      .mockResolvedValueOnce({ translatedText: 'bench' });
    const { result } = renderTranslationHook();

    await act(async () => {
      await result.current.triggerAutoTranslation('banco', { sentenceContext: 'Voy al banco.', mode: 'word' });
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();
    expect(translateText).toHaveBeenCalledWith(
      'banco',
      'es',
      'EN',
      expect.objectContaining({ signal: expect.any(Object), sentenceContext: 'Voy al banco.' })
    );
    expect(result.current.translation).toBe('bank');

    // Same term + same sentence hits cache.
    await act(async () => {
      await result.current.triggerAutoTranslation('banco', { sentenceContext: 'Voy al banco.', mode: 'word' });
    });
    expect(translateText).toHaveBeenCalledTimes(1);

    // Same term in a different sentence re-queries DeepL with the new sentence context.
    await act(async () => {
      await result.current.triggerAutoTranslation('banco', { sentenceContext: 'Me siento en el banco.', mode: 'word' });
    });
    expect(translateText).toHaveBeenCalledTimes(2);
    expect(translateText).toHaveBeenLastCalledWith(
      'banco',
      'es',
      'EN',
      expect.objectContaining({ signal: expect.any(Object), sentenceContext: 'Me siento en el banco.' })
    );
    expect(result.current.translation).toBe('bench');
  });

  test('wiktionary shares cache across sentences on word clicks while explicit AI Translate uses AI', async () => {
    translateText.mockResolvedValue({ translatedText: 'bank; bench' });
    translateSelectionWithContext.mockResolvedValue({ translatedText: 'bench (AI)' });
    const { result } = renderTranslationHook({
      globalSettings: { wordTranslationProvider: 'wiktionary' }
    });

    await act(async () => {
      await result.current.triggerAutoTranslation('banco', { sentenceContext: 'Voy al banco.', mode: 'word' });
    });
    await act(async () => {
      await result.current.triggerAutoTranslation('banco', { sentenceContext: 'Me siento en el banco.', mode: 'word' });
    });
    expect(translateText).toHaveBeenCalledTimes(1);
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    // Explicit AI Translate (mode: 'ai', force: true) must still invoke AI even when Wiktionary is active.
    await act(async () => {
      await result.current.triggerAutoTranslation('banco', {
        sentenceContext: 'Me siento en el banco.',
        force: true,
        mode: 'ai'
      });
    });
    expect(translateSelectionWithContext).toHaveBeenCalledWith(
      'banco',
      'Me siento en el banco.',
      'es',
      'EN',
      expect.objectContaining({ signal: expect.any(Object) })
    );
    expect(result.current.translation).toBe('bench (AI)');
  });
});
