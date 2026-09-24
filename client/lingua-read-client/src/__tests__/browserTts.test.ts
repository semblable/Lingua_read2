import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getPreferredVoiceURI,
  getVoicesForLanguage,
  isNaturalVoice,
  pickVoice,
  rankVoices,
  setPreferredVoiceURI,
  speakText,
  toSpeechLanguageTag
} from '../utils/browserTts';

const voice = (name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
  ({ name, lang, voiceURI: `uri:${name}`, default: false, localService: true, ...extra }) as SpeechSynthesisVoice;

const VOICES = [
  voice('Microsoft Hortense - French (France)', 'fr-FR'),
  voice('Microsoft Sylvie Online (Natural) - French (Canada)', 'fr-CA'),
  voice('Microsoft David - English (United States)', 'en-US', { default: true }),
  voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'),
  voice('Google français', 'fr-FR'),
  voice('Microsoft Paulina - Polish (Poland)', 'pl-PL')
];

describe('rankVoices', () => {
  test('puts natural voices of the exact tag first, then plain ones, then other regions', () => {
    expect(rankVoices(VOICES, 'fr-FR').map((v) => v.name)).toEqual([
      'Microsoft Denise Online (Natural) - French (France)',
      'Google français',
      'Microsoft Hortense - French (France)',
      'Microsoft Sylvie Online (Natural) - French (Canada)'
    ]);
  });

  test('leaves out voices of other languages', () => {
    expect(rankVoices(VOICES, 'pl-PL').map((v) => v.name)).toEqual(['Microsoft Paulina - Polish (Poland)']);
    expect(rankVoices(VOICES, 'de-DE')).toEqual([]);
    expect(rankVoices([], 'fr-FR')).toEqual([]);
  });

  test('recognizes natural voices across platforms', () => {
    expect(isNaturalVoice(voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'))).toBe(true);
    expect(isNaturalVoice(voice('Google Deutsch', 'de-DE'))).toBe(true);
    expect(isNaturalVoice(voice('Amélie (Enhanced)', 'fr-CA'))).toBe(true);
    expect(isNaturalVoice(voice('Microsoft Hortense - French (France)', 'fr-FR'))).toBe(false);
  });
});

describe('pickVoice', () => {
  test('uses the chosen voice while it is installed', () => {
    expect(pickVoice(VOICES, 'fr-FR', 'uri:Microsoft Hortense - French (France)')?.name)
      .toBe('Microsoft Hortense - French (France)');
  });

  test('falls back to the best voice when the chosen one is gone', () => {
    expect(pickVoice(VOICES, 'fr-FR', 'uri:Uninstalled voice')?.name)
      .toBe('Microsoft Denise Online (Natural) - French (France)');
  });

  test('returns null rather than the default English voice when the language has none', () => {
    expect(pickVoice(VOICES, 'de-DE')).toBeNull();
  });

  describe('offline', () => {
    const CLOUD_VOICES = [
      voice('Microsoft Hortense - French (France)', 'fr-FR'),
      voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', { localService: false }),
      voice('Google français', 'fr-FR', { localService: false })
    ];

    test('skips voices that need the internet, the chosen one included', () => {
      expect(pickVoice(CLOUD_VOICES, 'fr-FR', 'uri:Google français', true)?.name)
        .toBe('Microsoft Hortense - French (France)');
      expect(pickVoice(CLOUD_VOICES, 'fr-FR', null, true)?.name)
        .toBe('Microsoft Hortense - French (France)');
    });

    test('leaves the voice to the browser when only cloud voices exist for the language', () => {
      expect(pickVoice(CLOUD_VOICES.slice(1), 'fr-FR', null, true)).toBeNull();
    });

    test('online, cloud voices are still preferred', () => {
      expect(pickVoice(CLOUD_VOICES, 'fr-FR', null, false)?.name)
        .toBe('Microsoft Denise Online (Natural) - French (France)');
    });

    test('follows navigator.onLine by default', () => {
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      try {
        expect(pickVoice(CLOUD_VOICES, 'fr-FR')?.name).toBe('Microsoft Hortense - French (France)');
      } finally {
        onLine.mockRestore();
      }
    });
  });
});

describe('getVoicesForLanguage', () => {
  const originalSynth = window.speechSynthesis;
  let voices: SpeechSynthesisVoice[];
  let listeners: Array<() => void>;

  beforeEach(() => {
    voices = [];
    listeners = [];
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => voices,
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        removeEventListener: (_type: string, listener: () => void) => {
          listeners = listeners.filter((l) => l !== listener);
        }
      }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: originalSynth });
  });

  test('ranks the voices the browser already has', async () => {
    voices = VOICES;

    expect((await getVoicesForLanguage('PL')).map((v) => v.name)).toEqual(['Microsoft Paulina - Polish (Poland)']);
    expect(listeners).toHaveLength(0);
  });

  test('waits for voices that load late (Chrome), then stops listening', async () => {
    const pending = getVoicesForLanguage('PL');
    expect(listeners).toHaveLength(1);

    voices = VOICES;
    listeners[0]();

    expect((await pending).map((v) => v.name)).toEqual(['Microsoft Paulina - Polish (Poland)']);
    expect(listeners).toHaveLength(0);
  });

  test('gives up after a second when no voices arrive', async () => {
    vi.useFakeTimers();
    const pending = getVoicesForLanguage('PL');

    vi.advanceTimersByTime(1000);

    expect(await pending).toEqual([]);
    expect(listeners).toHaveLength(0);
  });

  test('is empty without speech synthesis', async () => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });

    expect(await getVoicesForLanguage('FR')).toEqual([]);
  });
});

describe('voice preference', () => {
  beforeEach(() => localStorage.clear());

  test('is stored per speech tag, so "FR" and "fr-FR" share it', () => {
    setPreferredVoiceURI('FR', 'uri:x');

    expect(getPreferredVoiceURI('fr-FR')).toBe('uri:x');
    expect(getPreferredVoiceURI('ES')).toBeNull();

    setPreferredVoiceURI('FR', null);
    expect(getPreferredVoiceURI('FR')).toBeNull();
  });

  test('toSpeechLanguageTag is unchanged', () => {
    expect(toSpeechLanguageTag('FR')).toBe('fr-FR');
    expect(toSpeechLanguageTag('pt')).toBe('pt-BR');
    expect(toSpeechLanguageTag('en_gb')).toBe('en-GB');
    expect(toSpeechLanguageTag(null)).toBe('en-US');
  });
});

describe('speakText voice selection', () => {
  const spoken: SpeechSynthesisUtterance[] = [];
  const originalSynth = window.speechSynthesis;
  const originalUtterance = window.SpeechSynthesisUtterance;

  beforeEach(() => {
    localStorage.clear();
    spoken.length = 0;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => VOICES,
        cancel: vi.fn(),
        speak: (utterance: SpeechSynthesisUtterance) => {
          spoken.push(utterance);
          utterance.onend?.({} as SpeechSynthesisEvent);
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: class {
        text: string;
        lang = '';
        rate = 1;
        voice: SpeechSynthesisVoice | null = null;
        onstart: (() => void) | null = null;
        onend: ((event: SpeechSynthesisEvent) => void) | null = null;
        onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: originalSynth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: originalUtterance });
  });

  test('uses the saved voice for the language, else the best one', async () => {
    await speakText({ text: 'Bonjour', languageCode: 'FR' });
    expect(spoken[0].voice?.name).toBe('Microsoft Denise Online (Natural) - French (France)');

    setPreferredVoiceURI('FR', 'uri:Google français');
    await speakText({ text: 'Bonjour', languageCode: 'FR' });
    expect(spoken[1].voice?.name).toBe('Google français');
  });

  test('an explicit voice (the settings preview) wins over the saved one', async () => {
    setPreferredVoiceURI('FR', 'uri:Google français');

    await speakText({ text: '1, 2, 3', languageCode: 'FR', voiceURI: 'uri:Microsoft Hortense - French (France)' });
    expect(spoken[0].voice?.name).toBe('Microsoft Hortense - French (France)');

    await speakText({ text: '1, 2, 3', languageCode: 'FR', voiceURI: null });
    expect(spoken[1].voice?.name).toBe('Microsoft Denise Online (Natural) - French (France)');
  });

  test('offline, reads with an on-device voice even when a cloud voice was chosen', async () => {
    const cloud = voice('Google français', 'fr-FR', { localService: false });
    const local = voice('Microsoft Hortense - French (France)', 'fr-FR');
    vi.spyOn(window.speechSynthesis, 'getVoices').mockReturnValue([cloud, local]);
    setPreferredVoiceURI('FR', cloud.voiceURI);
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      await speakText({ text: 'Bonjour', languageCode: 'FR' });
    } finally {
      onLine.mockRestore();
    }
    await speakText({ text: 'Bonjour', languageCode: 'FR' });

    expect(spoken[0].voice?.name).toBe('Microsoft Hortense - French (France)');
    // Back online, the chosen voice is used again.
    expect(spoken[1].voice?.name).toBe('Google français');
  });

  test('waits for voices that load late before choosing one', async () => {
    const synth = window.speechSynthesis;
    let onVoicesChanged: (() => void) | undefined;
    vi.spyOn(synth, 'getVoices').mockReturnValueOnce([]).mockReturnValue(VOICES);
    vi.mocked(synth.addEventListener).mockImplementation((_type, listener) => {
      onVoicesChanged = listener as () => void;
    });

    const pending = speakText({ text: 'Bonjour', languageCode: 'FR' });
    expect(spoken).toHaveLength(0);
    onVoicesChanged?.();
    await pending;

    expect(spoken).toHaveLength(1);
    expect(spoken[0].voice?.name).toBe('Microsoft Denise Online (Natural) - French (France)');
  });

  test('rejects and reports a speech error', async () => {
    vi.spyOn(window.speechSynthesis, 'speak').mockImplementation((utterance) => {
      utterance.onerror?.({ error: 'network' } as SpeechSynthesisErrorEvent);
    });
    const onError = vi.fn();

    await expect(speakText({ text: 'Bonjour', languageCode: 'FR', onError })).rejects.toThrow('network');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network' }));
  });

  test('leaves the voice to the browser when the language has none', async () => {
    await speakText({ text: 'Hallo', languageCode: 'DE' });

    expect(spoken[0].voice).toBeNull();
    expect(spoken[0].lang).toBe('de-DE');
  });
});
