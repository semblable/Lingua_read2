import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

// The AI providers the Settings page offers (OpenRouter, DeepSeek, ... and a custom endpoint).
// A user's settings for them are saved through PUT /usersettings (aiProvider, aiProviders, aiApiKeys).
export type AiProviderInfo = ResponseOf<'/api/AiProviders', 'get'>[number];
export type AiProviderTestResult = ResponseOf<'/api/AiProviders/{provider}/test', 'post'>;
export type AiProviderModels = ResponseOf<'/api/AiProviders/{provider}/models', 'get'>;
export type AiPromptDefaults = ResponseOf<'/api/AiProviders/prompt-defaults', 'get'>;

export const getAiPromptDefaults = (signal: AbortSignal): Promise<AiPromptDefaults> =>
  fetchApi<AiPromptDefaults>('/aiproviders/prompt-defaults', { signal });

export const getAiProviders = async (): Promise<AiProviderInfo[]> => {
  return (await fetchApi<AiProviderInfo[]>('/aiproviders')) ?? [];
};

/** Sends a one-word request with the provider's saved key and model. */
export const testAiProvider = async (provider: string): Promise<AiProviderTestResult> => {
  return fetchApi<AiProviderTestResult>(`/aiproviders/${encodeURIComponent(provider)}/test`, {
    method: 'POST'
  });
};

/** The model ids the provider offers, fetched with the saved key. */
export const getAiProviderModels = async (provider: string, signal?: AbortSignal): Promise<AiProviderModels> => {
  return fetchApi<AiProviderModels>(`/aiproviders/${encodeURIComponent(provider)}/models`, { signal, cache: 'no-store' });
};
