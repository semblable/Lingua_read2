import { test, expect, vi } from 'vitest';
import { updateUserSettings } from '../utils/api/settings';
import { fetchApi } from '../utils/api/client';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn() }));

test('form and secret patches cannot run concurrently, and failures do not block later saves', async () => {
  let resolveFirst!: (value: unknown) => void;
  vi.mocked(fetchApi).mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  vi.mocked(fetchApi).mockResolvedValueOnce({ hasAzureTranslatorKey: true });
  const form = updateUserSettings({ theme: 'light' }, { keepalive: true });
  const secret = updateUserSettings({ azureTranslatorKey: 'new-secret' });
  await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(1));
  expect(vi.mocked(fetchApi).mock.calls[0][1]).toMatchObject({ keepalive: true, body: JSON.stringify({ theme: 'light' }) });
  resolveFirst({ theme: 'light' });
  await form;
  await secret;
  expect(fetchApi).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetchApi).mock.calls[1][1]).toMatchObject({ body: JSON.stringify({ azureTranslatorKey: 'new-secret' }) });
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    vi.mocked(fetchApi).mockRejectedValueOnce(new Error('network'));
    await expect(updateUserSettings({ theme: 'dark' })).rejects.toThrow('network');
    vi.mocked(fetchApi).mockResolvedValueOnce({ theme: 'light' });
    await expect(updateUserSettings({ theme: 'light' })).resolves.toEqual({ theme: 'light' });
  } finally { errorLog.mockRestore(); }
});

test.each([['ASCII', 'a'.repeat(66000)], ['multibyte', '界'.repeat(22000)]])('oversized %s prompts save normally without keepalive', async (_label, prompt) => {
  vi.mocked(fetchApi).mockResolvedValueOnce({});
  await updateUserSettings({ customTranslationPrompt: prompt }, { keepalive: true });
  const options = vi.mocked(fetchApi).mock.calls.at(-1)![1];
  expect(options).toMatchObject({ keepalive: false });
  expect(JSON.parse(options!.body as string).customTranslationPrompt).toBe(prompt);
});
