import { test, expect } from '@playwright/test';
import { languages } from './data';
import { expectPageFits } from './bounds';

const revision = 'A'.repeat(64);
const lesson = {
  textId: 802, title: 'Ep. 98 — Uma viagem pela língua portuguesa', languageId: 21,
  languageCode: 'fr', languageName: 'Français', content: 'Éloïse suit la rivière. Le soleil éclaire les petites maisons.',
  words: [], isAudioLesson: true, hasSrtContent: true, audioFilePath: 'lesson-credit-silence.wav', studyRevision: revision,
};

// Authored ten-second silent audio exercises the browser's actual media events.
const silence = Buffer.alloc(44 + 80000, 128);
silence.write('RIFF'); silence.writeUInt32LE(silence.length - 8, 4); silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(8000, 24); silence.writeUInt32LE(8000, 28);
silence.writeUInt16LE(1, 32); silence.writeUInt16LE(8, 34);
silence.write('data', 36); silence.writeUInt32LE(80000, 40);

test('played audio refreshes fractional listens and library practice icons', async ({ page, context, baseURL }, info) => {
  const unexpected: string[] = [];
  const errors: string[] = [];
  const playback: { durationSeconds: number; clientEventId: string; lesson: {
    textId: number; sourceRevision: string; playedSeconds: number; audioDurationSeconds: number;
  } }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let listenCount = 0;
  const library = () => ({ breadcrumbs: [], folders: [], books: [], texts: [
    { ...lesson, languageName: 'Portuguese', totalWords: 3373, knownWords: 3293, readCount: 1, listenCount, isFinished: true },
    { textId: 803, title: 'Ep. 99 — Aprender outra língua', isAudioLesson: true, languageName: 'Portuguese', totalWords: 1931, knownWords: 1881, readCount: 2.5, listenCount: 1.2 },
    { textId: 804, title: 'Uma tarde em Lisboa', languageName: 'Portuguese', totalWords: 4570, knownWords: 4488, readCount: 3 },
    { textId: 805, title: 'Ep. 101 — Histórias de uma viagem', isAudioLesson: true, languageName: 'Portuguese', totalWords: 6436, knownWords: 6300, readCount: 0, listenCount: 0 },
  ].map(text => ({ ...text, createdAt: '2026-11-10T08:00:00Z', tag: 'Portuguese practice' })) });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === baseURL) {
      if (request.method() === 'GET') {
        const responses: Record<string, unknown> = {
          '/api/languages': languages, '/api/languages/21': languages[0], '/api/folders': [],
          '/api/folders/library': library(), '/api/texts/802': lesson,
          '/api/bookmarks/802': { sentenceIndices: [], lastSentenceIndex: null },
          '/api/activity/sentenceprogress/802': { lastSegmentIndex: 0, creditedSegmentIndices: [] },
          '/api/activity/audiolessonprogress/802': { currentPosition: 0 },
          '/api/lesson-study/802': { readCount: 1, listenCount }, '/api/words/language/21': [],
        };
        if (Object.hasOwn(responses, url.pathname)) { await route.fulfill({ json: responses[url.pathname] }); return; }
        if (url.pathname === '/lesson-credit-silence.wav') {
          await route.fulfill({ contentType: 'audio/wav', body: silence }); return;
        }
        if (url.pathname === '/api/texts/802/srt') {
          await route.fulfill({ contentType: 'text/plain', body: '1\n00:00:00,000 --> 00:00:10,000\nÉloïse suit la rivière.\n' }); return;
        }
        if (!url.pathname.startsWith('/api') && ['document', 'script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) {
          await route.continue(); return;
        }
      }
      // Only these two authored playback mutations are allowed; nothing reaches an account API.
      if (request.method() === 'PUT' && url.pathname === '/api/activity/audiolessonprogress') {
        await route.fulfill({ json: {} }); return;
      }
      if (request.method() === 'POST' && url.pathname === '/api/activity/logListening') {
        playback.push(request.postDataJSON());
        listenCount = 0.1; // The server arithmetic is covered by SQLite controller regressions.
        await route.fulfill({ json: { message: 'Synthetic playback saved' } }); return;
      }
    }
    unexpected.push(`${request.method()} ${url.href}`);
    await route.abort('blockedbyclient');
  });

  await page.goto('/layout/texts/802');
  await page.evaluate(() => { document.body.className = 'classic-dark-theme'; });
  await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
  const play = page.locator('.audiobook-player').getByTitle('Play/Pause (Space)', { exact: true });
  await play.click();
  await expect.poll(() => page.locator('audio').evaluate(audio => (audio as HTMLAudioElement).currentTime)).toBeGreaterThan(1.1);
  await play.click();
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: 'Open lesson controls', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Listened passes: 0.1', exact: true })).toBeAttached();
  expect(playback).toHaveLength(1);
  expect(playback[0].lesson.textId).toBe(802);
  expect(playback[0].lesson.sourceRevision).toBe(revision);
  expect(playback[0].lesson.playedSeconds).toBeGreaterThan(1);
  expect(playback[0].lesson.audioDurationSeconds).toBe(10);
  expect(playback[0].durationSeconds).toBeGreaterThanOrEqual(1);
  expect(playback[0].clientEventId).toBeTruthy();
  await expectPageFits(page);
  await page.screenshot({ path: info.outputPath('audio-listened-credit.png'), fullPage: true, animations: 'disabled' });

  await page.goto('/layout/library');
  await page.evaluate(() => { document.body.className = 'classic-dark-theme'; });
  await expect(page.getByLabel('Read passes: 2.5', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Read passes: 0', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Listened passes: 0.1', { exact: true })).toBeVisible();
  await expectPageFits(page);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath('library-practice-counts.png'), fullPage: true, animations: 'disabled' });
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
