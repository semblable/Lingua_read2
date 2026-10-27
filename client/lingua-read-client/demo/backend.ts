import { mergeSettings } from '../src/contexts/SettingsContext';
import { demoLanguages, demoSrt, initialWords, lessons, normalizeTerm, spanishTranslations, type DemoWord } from './content/fixtures';

export const DEMO_API = '/__linguaread_demo_api';
export const DEMO_CHANGE_EVENT = 'linguaread:demo-change';

export function normalizeBase(base: string): string {
  if (!base.startsWith('/') || base.startsWith('//') || base.includes('..') || /[?#]/.test(base)) {
    throw new Error('The demo base must be a local absolute directory path.');
  }
  return base.endsWith('/') ? base : `${base}/`;
}

export function createDemoBackend(basePath: string) {
  const base = normalizeBase(basePath);
  let words = initialWords();
  let nextWordId = 1000;
  let settings = mergeSettings({
    theme: 'light', textSize: 19, textFont: 'Lora', readingUiMode: 'modern',
    readerContentWidth: 820, leftPanelWidth: 68, showWordInfoPanel: true,
    showDesktopLessonControls: false, autoTranslateWords: true,
    sentenceTtsEnabled: false, sentenceMode: false, translationTargetLanguageCode: 'EN',
    pauseOnWordClick: true, readerParagraphIndent: false,
  });
  const bookmarks = new Map<number, number[]>();
  const positions = new Map<number, number>();
  const mined: Array<{ wordId: number; sentence: string; textTitle: string }> = [];

  const notify = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(DEMO_CHANGE_EVENT));
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  const saveWord = (languageId: number, term: string, status: number, translation: string, keepStatus = false) => {
    let word = words.find(w => w.languageId === languageId && normalizeTerm(w.term) === normalizeTerm(term));
    if (word) {
      if (!keepStatus || word.status === 0) word.status = status;
      if (translation) word.translation = translation;
    } else {
      word = { wordId: nextWordId++, term, status, translation, languageId };
      words.push(word);
    }
    notify();
    return word;
  };

  async function respond(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(DEMO_API.length).toLowerCase();
    const method = request.method;
    let body: Record<string, unknown> = {};
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = await request.text();
      try { body = raw ? JSON.parse(raw) as Record<string, unknown> : {}; }
      catch { return json({ message: 'Invalid demo request.' }, 400); }
    }
    const match = (pattern: RegExp) => path.match(pattern);
    let found: RegExpMatchArray | null;

    if (path === '/usersettings') {
      if (method === 'PUT') settings = mergeSettings(body, settings);
      return json(settings);
    }
    if (path === '/languages' || path === '/translation/languages') return json(demoLanguages);
    if ((found = match(/^\/languages\/(\d+)$/))) return json(demoLanguages.find(l => l.languageId === Number(found![1])));
    if ((found = match(/^\/texts\/(\d+)\/srt$/))) {
      return new Response(Number(found[1]) === 2 ? demoSrt : '', { headers: { 'Content-Type': 'text/plain' } });
    }
    if ((found = match(/^\/texts\/(\d+)\/word-linking-status$/))) return json({ wordLinkingStatus: 'complete' });
    if ((found = match(/^\/texts\/(\d+)$/))) {
      const lesson = lessons.find(l => l.textId === Number(found![1]));
      if (!lesson) return json({ message: 'This sample does not exist.' }, 404);
      return json({
        textId: lesson.textId, title: lesson.title, content: lesson.sentences.join('\n\n'),
        languageId: lesson.languageId, languageName: lesson.languageName, languageCode: lesson.languageCode,
        bookId: null, folderId: null, isFinished: false, isAudioLesson: lesson.isAudioLesson,
        hasSrtContent: lesson.isAudioLesson, wordLinkingStatus: 'complete',
        audioFilePath: lesson.isAudioLesson ? `${base}audio/north-wind-and-sun.mp3`.slice(1) : null,
        words: words.filter(w => w.languageId === lesson.languageId),
      });
    }
    if (match(/^\/texts\/\d+\/complete$/)) return json({ message: 'Sample completed. Your real library is available in the self-hosted app.' });

    if ((found = match(/^\/words\/language\/(\d+)$/))) return json(words.filter(w => w.languageId === Number(found![1])));
    if (path === '/words' && method === 'POST') {
      const lesson = lessons.find(l => l.textId === Number(body.textId));
      if (!lesson) return json({ message: 'Choose a sample lesson first.' }, 400);
      return json(saveWord(lesson.languageId, String(body.term || ''), Number(body.status || 1), String(body.translation || '')));
    }
    if ((found = match(/^\/words\/(\d+)$/))) {
      const word = words.find(w => w.wordId === Number(found![1]));
      if (!word) return json({ message: 'Sample word not found.' }, 404);
      if (method === 'DELETE') { words = words.filter(w => w !== word); notify(); return json({ message: 'Deleted from this demo.' }); }
      if (method === 'PUT') {
        word.status = Number(body.status || word.status);
        if (body.translation) word.translation = String(body.translation);
        notify();
      }
      return json(word);
    }
    if (path === '/words/batch' && method === 'POST') {
      const terms = Array.isArray(body.terms) ? body.terms as Array<Record<string, unknown>> : [];
      return json({ words: terms.map(term => saveWord(Number(body.languageId), String(term.term), Number(term.status || 5), String(term.translation || ''), body.keepExistingStatus === true)) });
    }
    if (path === '/translation/batch') {
      const glossary = lessons.find(l => l.languageCode === body.sourceLanguageCode)?.glossary || {};
      return json(Object.fromEntries((body.words as string[] || []).map(term => [normalizeTerm(term), glossary[normalizeTerm(term)] || ''])));
    }
    if (path === '/translation' || path === '/sentencetranslation/selection') {
      const glossary = lessons.find(l => l.languageCode === body.sourceLanguageCode)?.glossary || {};
      const term = normalizeTerm(String(body.selectedText || body.text || ''));
      return glossary[term] ? json({ translatedText: glossary[term] }) : json({ message: 'No prepared translation for this selection. Try an individual word in the sample.' }, 422);
    }
    if (path === '/sentencetranslation' || path === '/sentencetranslation/full-text') {
      const lesson = lessons.find(l => l.languageCode === body.sourceLanguageCode);
      const index = lesson?.sentences.findIndex(s => s.trim() === String(body.text).trim()) ?? -1;
      return json({ translatedText: lesson?.textId === 1 ? index >= 0 ? spanishTranslations[index] : spanishTranslations.join('\n\n') : 'This English sample uses English vocabulary explanations. Select a word to see its prepared meaning.' });
    }
    if (path === '/sentencetranslation/explain') return json({ explanationText: 'Prepared demo explanation — no AI request was made.\n\nNotice how the sentence connects an everyday action with a place or time. In the self-hosted app, your configured AI provider explains the sentence you select.' });
    if (path === '/summarization') return json({ summaryText: 'Prepared demo summary: a small pause in an ordinary day becomes an opportunity to read, notice something new, and enjoy a quiet moment. Live summaries use your provider in the self-hosted app.' });
    if ((found = match(/^\/bookmarks\/(\d+)(?:\/(\d+))?$/))) {
      const textId = Number(found[1]);
      let indices = bookmarks.get(textId) || [];
      if (method === 'PUT' && found[2] != null) {
        const index = Number(found[2]);
        indices = body.bookmarked ? [...new Set([...indices, index])] : indices.filter(i => i !== index);
        bookmarks.set(textId, indices);
      }
      return json({ textId, sentenceIndices: indices, lastSentenceIndex: indices.at(-1) ?? null });
    }
    if ((found = match(/^\/activity\/sentenceprogress\/(\d+)$/))) return json({ textId: Number(found[1]), lastSegmentIndex: 0, creditedSegmentIndices: [] });
    if ((found = match(/^\/activity\/audiolessonprogress\/(\d+)$/))) return json({ currentPosition: positions.get(Number(found[1])) || 0 });
    if (path === '/activity/audiolessonprogress' && method === 'PUT') { positions.set(Number(body.textId), Number(body.currentPosition || 0)); return json({ saved: true }); }
    if (path === '/activity/loglistening' || path === '/activity/logsentenceread') return json({ saved: true });
    if (path === '/srs/mine') {
      const item = { wordId: Number(body.wordId), sentence: String(body.sentence || ''), textTitle: String(body.textTitle || '') };
      if (!mined.some(m => m.wordId === item.wordId && m.sentence === item.sentence)) mined.push(item);
      notify();
      return json({ message: 'Sentence saved in this demo. FSRS scheduling runs in the self-hosted app.' });
    }
    if (match(/^\/srs\/reading-credit\/\d+$/)) return json({ applied: false, message: 'Reading credit and FSRS scheduling run in the self-hosted app.' });
    if ((found = match(/^\/srs\/phrases\/(\d+)$/))) return json(mined.filter(m => m.wordId === Number(found![1])));
    // Unsupported actions fail locally. There is deliberately no production fallback.
    return json({ message: 'This action is available in the self-hosted app, outside the sample demo.' }, 501);
  }

  return {
    respond,
    snapshot: () => ({ words: structuredClone(words), mined: structuredClone(mined) }),
    reset: () => { words = initialWords(); nextWordId = 1000; bookmarks.clear(); positions.clear(); mined.length = 0; notify(); },
  };
}

export function createDemoFetch(backend: DemoBackend, nativeFetch: typeof fetch, origin: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (init?.signal?.aborted || (input instanceof Request && input.signal.aborted)) throw new DOMException('Aborted', 'AbortError');
    if (url.origin === new URL(origin).origin && (url.pathname === DEMO_API || url.pathname.startsWith(`${DEMO_API}/`))) {
      const request = input instanceof Request ? new Request(input, init) : new Request(url, init);
      return backend.respond(request);
    }
    if (url.origin !== new URL(origin).origin || /^\/api(?:\/|$)/i.test(url.pathname)) {
      throw new Error('The static demo cannot call external services or a real application API.');
    }
    return nativeFetch(input, init); // Same-origin static assets, such as sample audio.
  };
}

export function installDemoBackend(base: string) {
  const backend = createDemoBackend(base);
  window.fetch = createDemoFetch(backend, window.fetch.bind(window), window.location.href);
  return backend;
}

export type DemoBackend = ReturnType<typeof createDemoBackend>;
