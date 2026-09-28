import React, { useCallback, useEffect, useRef, useState } from 'react';
import { translateText, translateSelectionWithContext } from '../utils/api';
import type { Settings } from '../contexts/SettingsContext';
import type { Text as TextDto } from '../utils/api/texts';

// Reader pages augment TextDto with locally-attached fields; consumers must
// narrow extras before reading them.
export type ReaderTextLike = TextDto & Record<string, unknown>;

export type UseWordTranslationArgs = {
  text: ReaderTextLike | null;
  globalSettings: Settings;
  targetLanguageCode: string;
  applyTranslationToDisplayedWord: (term: string, translation: string) => void;
};

export type UseWordTranslationResult = {
  translation: string;
  setTranslation: React.Dispatch<React.SetStateAction<string>>;
  isTranslating: boolean;
  setIsTranslating: React.Dispatch<React.SetStateAction<boolean>>;
  wordTranslationError: string;
  setWordTranslationError: React.Dispatch<React.SetStateAction<string>>;
  triggerAutoTranslation: (
    term: string,
    options?: { sentenceContext?: string; force?: boolean }
  ) => Promise<void>;
  // Resolves to the box text after the append, or null when nothing changed.
  appendAutoTranslation: (
    term: string,
    options?: { sentenceContext?: string }
  ) => Promise<string | null>;
  cancelInflight: () => void;
  clearCache: () => void;
};

type ApiError = { name?: string; status?: number; message?: string } | null;

export const useWordTranslation = ({
  text,
  globalSettings,
  targetLanguageCode,
  applyTranslationToDisplayedWord
}: UseWordTranslationArgs): UseWordTranslationResult => {
  const [translation, setTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [wordTranslationError, setWordTranslationError] = useState('');
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationCacheRef = useRef<Map<string, string>>(new Map());
  // The box can't be edited mid-request (it is disabled), so this is current when a request lands.
  const translationRef = useRef(translation);

  useEffect(() => {
    translationRef.current = translation;
  }, [translation]);

  const cancelInflight = useCallback(() => {
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    // The cancelled request's finally no longer owns the flag, so reset it here.
    setIsTranslating(false);
  }, []);

  const clearCache = useCallback(() => {
    translationCacheRef.current.clear();
  }, []);

  const triggerAutoTranslation = useCallback(
    async (
      termToTranslate: string,
      options: { sentenceContext?: string; force?: boolean } = {}
    ) => {
      const { sentenceContext = '', force = false } = options;
      if (!termToTranslate || !text?.languageCode) return;
      if (!force && !globalSettings.autoTranslateWords) return;

      // Wiktionary is a per-word dictionary; it ignores sentence context, so route the
      // click to the word-lookup endpoint (which the backend factory maps to Wiktionary)
      // rather than the context-aware AI selection endpoint.
      const useWiktionary = globalSettings.wordTranslationProvider === 'wiktionary';
      const useContext = !!sentenceContext && !useWiktionary;
      const cacheKey = `${text.languageCode}|${targetLanguageCode}|${useContext ? 'sel' : 'word'}|${useContext ? sentenceContext : ''}|${termToTranslate}`;
      const cached = translationCacheRef.current.get(cacheKey);
      if (!force && cached) {
        translationCacheRef.current.delete(cacheKey);
        translationCacheRef.current.set(cacheKey, cached);
        setIsTranslating(false);
        setWordTranslationError('');
        setTranslation(cached);
        applyTranslationToDisplayedWord(termToTranslate, cached);
        return;
      }

      translationAbortRef.current?.abort();
      const controller = new AbortController();
      translationAbortRef.current = controller;

      setIsTranslating(true);
      setWordTranslationError('');
      try {
        const result = useContext
          ? await translateSelectionWithContext(termToTranslate, sentenceContext, text.languageCode, targetLanguageCode, { signal: controller.signal })
          : await translateText(termToTranslate, text.languageCode, targetLanguageCode, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result?.translatedText) {
          const cache = translationCacheRef.current;
          cache.set(cacheKey, result.translatedText);
          if (cache.size > 100) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey !== undefined) cache.delete(oldestKey);
          }
          setTranslation(result.translatedText);
          applyTranslationToDisplayedWord(termToTranslate, result.translatedText);
        } else {
          setWordTranslationError('Translation not found.');
        }
      } catch (err: unknown) {
        const e = err as ApiError;
        if (e?.name === 'AbortError' || controller.signal.aborted) {
          return;
        }
        console.error('Auto-translation failed:', err);
        if (e?.status === 429) {
          setWordTranslationError('Provider rate limit reached — try again in a few seconds.');
        } else {
          setWordTranslationError(`Translation failed: ${e?.message}`);
        }
      } finally {
        if (translationAbortRef.current === controller) {
          translationAbortRef.current = null;
          setIsTranslating(false);
        }
      }
    },
    [globalSettings.autoTranslateWords, globalSettings.wordTranslationProvider, text?.languageCode, targetLanguageCode, applyTranslationToDisplayedWord]
  );

  const appendAutoTranslation = useCallback(
    async (
      termToTranslate: string,
      options: { sentenceContext?: string } = {}
    ): Promise<string | null> => {
      const { sentenceContext = '' } = options;
      if (!termToTranslate || !text?.languageCode || !sentenceContext) return null;

      translationAbortRef.current?.abort();
      const controller = new AbortController();
      translationAbortRef.current = controller;

      setIsTranslating(true);
      setWordTranslationError('');
      try {
        const result = await translateSelectionWithContext(
          termToTranslate,
          sentenceContext,
          text.languageCode,
          targetLanguageCode,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return null;
        const newTranslation = result?.translatedText?.trim();
        if (!newTranslation) {
          setWordTranslationError('Translation not found.');
          return null;
        }

        const cacheKey = `${text.languageCode}|${targetLanguageCode}|sel|${sentenceContext}|${termToTranslate}`;
        const cache = translationCacheRef.current;
        cache.set(cacheKey, newTranslation);
        if (cache.size > 100) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }

        const existing = (translationRef.current || '').trim();
        let combined = newTranslation;
        if (existing) {
          const haystack = existing.toLowerCase();
          const needle = newTranslation.toLowerCase();
          if (haystack === needle || haystack.split(/\s*,\s*/).includes(needle)) {
            return null;
          }
          combined = `${existing}, ${newTranslation}`;
        }
        setTranslation(combined);
        applyTranslationToDisplayedWord(termToTranslate, combined);
        return combined;
      } catch (err: unknown) {
        const e = err as ApiError;
        if (e?.name === 'AbortError' || controller.signal.aborted) {
          return null;
        }
        console.error('Append translation failed:', err);
        if (e?.status === 429) {
          setWordTranslationError('Provider rate limit reached — try again in a few seconds.');
        } else {
          setWordTranslationError(`Translation failed: ${e?.message}`);
        }
        return null;
      } finally {
        if (translationAbortRef.current === controller) {
          translationAbortRef.current = null;
          setIsTranslating(false);
        }
      }
    },
    [text?.languageCode, targetLanguageCode, applyTranslationToDisplayedWord]
  );

  return {
    translation,
    setTranslation,
    isTranslating,
    setIsTranslating,
    wordTranslationError,
    setWordTranslationError,
    triggerAutoTranslation,
    appendAutoTranslation,
    cancelInflight,
    clearCache
  };
};
