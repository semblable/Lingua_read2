import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoBackend, createDemoFetch, DEMO_API } from './backend';
import { demoSrt, lessons } from './content/fixtures';

const request = (path: string, method = 'GET', body?: unknown) => new Request(`http://localhost${DEMO_API}${path}`, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

afterEach(() => vi.restoreAllMocks());

describe('static demo boundary', () => {
  it('keeps reader word edits in this instance and resets them without affecting another visitor', async () => {
    const first = createDemoBackend('/Lingua_read2/');
    const second = createDemoBackend('/Lingua_read2/');
    const word = first.snapshot().words.find(w => w.term === 'río')!;
    await first.respond(request(`/words/${word.wordId}`, 'PUT', { status: 5, translation: 'river' }));
    const reader = await (await first.respond(request('/texts/1'))).json();
    expect(reader.words.find((w: { wordId: number }) => w.wordId === word.wordId).status).toBe(5);
    expect(second.snapshot().words.find(w => w.wordId === word.wordId)?.status).toBe(2);
    first.reset();
    expect(first.snapshot().words.find(w => w.wordId === word.wordId)?.status).toBe(2);
  });

  it('serves audio below the Pages project path with one timestamped cue per transcript segment', async () => {
    const backend = createDemoBackend('/another-repository/');
    const audioLesson = await (await backend.respond(request('/texts/2'))).json();
    expect(audioLesson.audioFilePath).toBe('another-repository/audio/north-wind-and-sun.mp3');
    const srt = await (await backend.respond(request('/texts/2/srt'))).text();
    expect(srt).toBe(demoSrt);
    expect(srt.match(/ --> /g)).toHaveLength(lessons[1].sentences.length);
    for (const sentence of lessons[1].sentences) expect(srt).toContain(sentence);
  });

  it('stores mined sentences locally without inventing scheduling results or translations', async () => {
    const backend = createDemoBackend('/');
    await backend.respond(request('/srs/mine', 'POST', { wordId: 101, sentence: 'A sentence worth keeping.', textTitle: 'Sample' }));
    expect(backend.snapshot().mined).toHaveLength(1);
    expect((await backend.respond(request('/srs/review', 'POST', { grade: 3 }))).status).toBe(501);
    expect((await backend.respond(request('/translation', 'POST', { sourceLanguageCode: 'ES', text: 'not in the sample' }))).status).toBe(422);
    expect((await backend.respond(request('/database/restore', 'POST', {}))).status).toBe(501);
    backend.reset();
    expect(backend.snapshot().mined).toHaveLength(0);
  });

  it('blocks external and real API requests while allowing same-origin sample assets', async () => {
    const native = vi.fn().mockResolvedValue(new Response('asset'));
    const demoFetch = createDemoFetch(createDemoBackend('/Lingua_read2/'), native, 'http://localhost/');
    await expect(demoFetch('https://example.com/api/translation')).rejects.toThrow('cannot call');
    await expect(demoFetch('/api/words')).rejects.toThrow('cannot call');
    const sample = await demoFetch(`${DEMO_API}/texts/1`);
    expect(sample.status).toBe(200);
    expect(native).not.toHaveBeenCalled();
    await demoFetch('/Lingua_read2/audio/north-wind-and-sun.mp3');
    expect(native).toHaveBeenCalledOnce();
  });
});
