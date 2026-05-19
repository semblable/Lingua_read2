import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

export type TranslationResponse = ResponseOf<'/api/Translation', 'post'>;
export type BatchTranslationResponse = ResponseOf<'/api/Translation/batch', 'post'>;
export type SentenceTranslationResponse = ResponseOf<'/api/SentenceTranslation', 'post'>;
export type SentenceExplanationResponse = ResponseOf<'/api/SentenceTranslation/explain', 'post'>;
export type SelectionTranslationResponse = ResponseOf<
  '/api/SentenceTranslation/selection',
  'post'
>;
export type FullTextTranslationResponse = ResponseOf<
  '/api/SentenceTranslation/full-text',
  'post'
>;
export type StoryGenerationResponse = ResponseOf<'/api/StoryGeneration', 'post'>;
export type SummarizationResponse = ResponseOf<'/api/Summarization', 'post'>;
export type SupportedLanguages = ResponseOf<'/api/Translation/languages', 'get'>;

export type AbortSignalOptions = { signal?: AbortSignal };

export const translateText = async (
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string,
  { signal }: AbortSignalOptions = {}
): Promise<TranslationResponse> => {
  try {
    return await fetchApi<TranslationResponse>('/translation', {
      method: 'POST',
      body: JSON.stringify({ text, sourceLanguageCode, targetLanguageCode }),
      signal
    });
  } catch (error) {
    console.error('Translation failed:', error);
    throw error;
  }
};

// Story Generation API
export const generateStory = async (
  prompt: string,
  language: string,
  level: string,
  maxLength: number
): Promise<StoryGenerationResponse> => {
  try {
    return await fetchApi<StoryGenerationResponse>('/storygeneration', {
      method: 'POST',
      body: JSON.stringify({ prompt, language, level, maxLength })
    });
  } catch (error) {
    console.error('Story generation failed:', error);
    throw error;
  }
};

export const summarizeText = async (
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string,
  maxSummaryWords: number = 200
): Promise<SummarizationResponse> => {
  try {
    return await fetchApi<SummarizationResponse>('/summarization', {
      method: 'POST',
      body: JSON.stringify({ text, sourceLanguageCode, targetLanguageCode, maxSummaryWords })
    });
  } catch (error) {
    console.error('Summarization failed:', error);
    throw error;
  }
};

export const translateSentence = async (
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string,
  { signal }: AbortSignalOptions = {}
): Promise<SentenceTranslationResponse> => {
  try {
    return await fetchApi<SentenceTranslationResponse>('/sentencetranslation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text, sourceLanguageCode, targetLanguageCode }),
      signal
    });
  } catch (error) {
    console.error('Sentence translation failed:', error);
    throw error;
  }
};

export const translateSelectionWithContext = async (
  selectedText: string,
  sentenceContext: string,
  sourceLanguageCode: string,
  targetLanguageCode: string,
  { signal }: AbortSignalOptions = {}
): Promise<SelectionTranslationResponse> => {
  try {
    return await fetchApi<SelectionTranslationResponse>('/sentencetranslation/selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ selectedText, sentenceContext, sourceLanguageCode, targetLanguageCode }),
      signal
    });
  } catch (error) {
    console.error('Selection translation failed:', error);
    throw error;
  }
};

export const explainSentence = async (
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string
): Promise<SentenceExplanationResponse> => {
  try {
    return await fetchApi<SentenceExplanationResponse>('/sentencetranslation/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text, sourceLanguageCode, targetLanguageCode })
    });
  } catch (error) {
    console.error('Sentence explanation failed:', error);
    throw error;
  }
};

export const translateFullText = async (
  text: string,
  sourceLanguageCode: string,
  targetLanguageCode: string
): Promise<FullTextTranslationResponse> => {
  try {
    return await fetchApi<FullTextTranslationResponse>('/sentencetranslation/full-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text, sourceLanguageCode, targetLanguageCode })
    });
  } catch (error) {
    console.error('Full text translation failed:', error);
    throw error;
  }
};

export const getSupportedLanguages = (): Promise<SupportedLanguages> => {
  return fetchApi<SupportedLanguages>('/translation/languages');
};

export const batchTranslateWords = async (
  words: string[],
  targetLanguageCode: string,
  sourceLanguageCode: string | null = null
): Promise<BatchTranslationResponse> => {
  try {
    return await fetchApi<BatchTranslationResponse>('/translation/batch', {
      method: 'POST',
      body: JSON.stringify({ words, targetLanguageCode, sourceLanguageCode })
    });
  } catch (error) {
    console.error('Batch translation failed:', error);
    throw error;
  }
};
