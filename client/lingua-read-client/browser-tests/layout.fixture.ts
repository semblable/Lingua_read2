import { test as base, expect } from '@playwright/test';
import type { Text } from '../src/utils/api/texts';
import type { LibraryContents } from '../src/utils/api/folders';
import { languages } from './data';

const readerText: Text = {
  textId: 801, title: 'Une promenade au bord de la rivière', languageId: 21,
  languageCode: 'fr', content: 'Éloïse suit la rivière. Le soleil éclaire les petites maisons.',
  words: [],
};
const audioText: Text = {
  ...readerText, textId: 802, title: 'Les sons du matin', isAudioLesson: true,
  audioFilePath: 'synthetic-silence.wav', hasSrtContent: true,
};
const library: LibraryContents = {
  breadcrumbs: [], folders: [], books: [],
  texts: [readerText, audioText].map(text => ({
    textId: text.textId, title: text.title, languageId: 21, languageName: 'Français',
    totalWords: 14, knownWords: 9, isAudioLesson: !!text.isAudioLesson,
    createdAt: '2026-11-10T08:00:00Z',
  })),
};

// One second of authored silent PCM audio; never request a real media asset.
const silence = Buffer.alloc(44 + 8000, 128);
silence.write('RIFF'); silence.writeUInt32LE(silence.length - 8, 4); silence.write('WAVEfmt ', 8);
silence.writeUInt32LE(16, 16); silence.writeUInt16LE(1, 20); silence.writeUInt16LE(1, 22);
silence.writeUInt32LE(8000, 24); silence.writeUInt32LE(8000, 28);
silence.writeUInt16LE(1, 32); silence.writeUInt16LE(8, 34);
silence.write('data', 36); silence.writeUInt32LE(8000, 40);

export const test = base.extend<{ openLayout: (path: string) => Promise<void> }>({
  openLayout: async ({ page, context, baseURL }, runFixture) => {
    const unexpectedRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const responses: Record<string, unknown> = {
      '/api/languages': languages,
      '/api/languages/21': languages[0],
      '/api/folders': [],
      '/api/folders/library': library,
      '/api/texts/801': readerText,
      '/api/texts/802': audioText,
      '/api/bookmarks/801': { sentenceIndices: [], lastSentenceIndex: null },
      '/api/bookmarks/802': { sentenceIndices: [], lastSentenceIndex: null },
      '/api/words/language/21': [],
      '/api/words/language/21/paginated': { items: [], totalItems: 0, totalPages: 0 },
      '/api/activity/sentenceprogress/801': { lastSegmentIndex: 0, creditedSegmentIndices: [] },
      '/api/activity/sentenceprogress/802': { lastSegmentIndex: 0, creditedSegmentIndices: [] },
      '/api/activity/audiolessonprogress/802': { currentPosition: 0 },
      '/api/lesson-study/801': { readCount: 0, listenCount: 0 },
      '/api/lesson-study/802': { readCount: 0, listenCount: 0 },
    };
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === baseURL && request.method() === 'GET') {
        if (Object.hasOwn(responses, url.pathname)) {
          await route.fulfill({ json: responses[url.pathname] });
          return;
        }
        if (url.pathname === '/api/texts/802/srt') {
          await route.fulfill({ contentType: 'text/plain', body: '1\n00:00:00,000 --> 00:00:01,000\nÉloïse suit la rivière.\n' });
          return;
        }
        if (url.pathname === '/synthetic-silence.wav') {
          await route.fulfill({ contentType: 'audio/wav', body: silence });
          return;
        }
        if (!url.pathname.startsWith('/api') && ['document', 'script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) {
          await route.continue();
          return;
        }
      }
      unexpectedRequests.push(`${request.method()} ${url.href}`);
      await route.abort('blockedbyclient');
    });
    await page.clock.setFixedTime(new Date('2026-11-12T11:00:00Z'));
    await runFixture(async path => {
      const query = new URLSearchParams(path.split('?')[1]);
      if (query.get('mixed') === '1') {
        const words = ['Éloïse', 'suit', 'rivière', 'soleil', 'maisons', 'le'].map((term, index) => ({
          wordId: 900 + index, languageId: 21, term, status: index + 1, translation: `Synthetic meaning ${index + 1}`,
        }));
        responses['/api/texts/801'] = { ...readerText, words };
        responses['/api/texts/802'] = { ...audioText, words };
        responses['/api/words/language/21'] = words;
      }
      await page.goto(`/layout/${path}`);
      await page.evaluate(() => document.fonts.ready);
    });
    expect(unexpectedRequests, 'Layout fixtures must reject mutations and external requests').toEqual([]);
    expect(pageErrors, 'Real page components must render without browser errors').toEqual([]);
  },
});

export { expect };
