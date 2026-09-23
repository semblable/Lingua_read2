const LANGUAGE_TAG_OVERRIDES: Record<string, string> = {
  AR: 'ar-SA',
  BG: 'bg-BG',
  CS: 'cs-CZ',
  DA: 'da-DK',
  DE: 'de-DE',
  EL: 'el-GR',
  EN: 'en-US',
  ES: 'es-ES',
  FI: 'fi-FI',
  FR: 'fr-FR',
  HE: 'he-IL',
  HI: 'hi-IN',
  HR: 'hr-HR',
  HU: 'hu-HU',
  ID: 'id-ID',
  IT: 'it-IT',
  JA: 'ja-JP',
  KO: 'ko-KR',
  NB: 'nb-NO',
  NL: 'nl-NL',
  NO: 'nb-NO',
  PL: 'pl-PL',
  PT: 'pt-BR',
  RO: 'ro-RO',
  RU: 'ru-RU',
  SK: 'sk-SK',
  SL: 'sl-SI',
  SV: 'sv-SE',
  TH: 'th-TH',
  TR: 'tr-TR',
  UK: 'uk-UA',
  VI: 'vi-VN',
  ZH: 'zh-CN'
};

const DEFAULT_RATE = 1;
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;

function getSynth(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return null;
  }

  return window.speechSynthesis;
}

export function isSpeechSynthesisSupported(): boolean {
  return Boolean(getSynth() && typeof window.SpeechSynthesisUtterance !== 'undefined');
}

export function clampSpeechRate(rate: number | string | null | undefined): number {
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate)) {
    return DEFAULT_RATE;
  }

  return Math.min(MAX_RATE, Math.max(MIN_RATE, numericRate));
}

export function toSpeechLanguageTag(languageCode: string | null | undefined): string {
  if (!languageCode || typeof languageCode !== 'string') {
    return 'en-US';
  }

  const trimmed = languageCode.trim();
  if (!trimmed) {
    return 'en-US';
  }

  const normalized = trimmed.replace('_', '-');
  if (normalized.includes('-')) {
    const [baseLanguage, region] = normalized.split('-');
    if (baseLanguage && region) {
      return `${baseLanguage.toLowerCase()}-${region.toUpperCase()}`;
    }
  }

  return LANGUAGE_TAG_OVERRIDES[normalized.toUpperCase()] || normalized.toLowerCase();
}

// Neural/cloud-backed voices sound far better than the default robotic ones,
// and every platform names them differently: Edge "Microsoft … Online
// (Natural)", Chrome "Google …", Apple "… (Enhanced)" / "(Premium)".
const NATURAL_VOICE_PATTERN = /natural|neural|online|premium|enhanced/i;

export function isNaturalVoice(voice: SpeechSynthesisVoice): boolean {
  return NATURAL_VOICE_PATTERN.test(voice.name || '') || /^google /i.test(voice.name || '');
}

/**
 * Voices for `speechLang`, best first: the exact tag (e.g. fr-FR) before other
 * regions of the language (fr-CA), and within each, natural voices first.
 * Voices of other languages are left out.
 */
export function rankVoices(
  voices: SpeechSynthesisVoice[] | null | undefined,
  speechLang: string
): SpeechSynthesisVoice[] {
  if (!voices || voices.length === 0) {
    return [];
  }

  const normalizedLang = speechLang.toLowerCase();
  const baseLanguage = normalizedLang.split('-')[0];
  const score = (voice: SpeechSynthesisVoice): number => {
    const voiceLang = (voice.lang || '').toLowerCase().replace('_', '-');
    let value;
    if (voiceLang === normalizedLang || voiceLang.startsWith(`${normalizedLang}-`)) {
      value = 4;
    } else if (voiceLang === baseLanguage || voiceLang.startsWith(`${baseLanguage}-`)) {
      value = 2;
    } else {
      return -1;
    }
    return isNaturalVoice(voice) ? value + 1 : value;
  };

  return voices
    .map((voice, index) => ({ voice, index, score: score(voice) }))
    .filter((entry) => entry.score >= 0)
    // Stable: equal scores keep the browser's own order.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.voice);
}

/**
 * The chosen voice if it's still installed, else the best-ranked one. Null
 * when the device has no voice for the language: the browser then picks from
 * utterance.lang instead of us forcing the default (often English) voice.
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[] | null | undefined,
  speechLang: string,
  preferredVoiceURI?: string | null
): SpeechSynthesisVoice | null {
  if (preferredVoiceURI && voices) {
    const preferred = voices.find((voice) => voice.voiceURI === preferredVoiceURI);
    if (preferred) {
      return preferred;
    }
  }
  return rankVoices(voices, speechLang)[0] ?? null;
}

// Voice choice per speech tag. Deliberately device-local (never synced to the
// server): every device and browser has its own set of voices, so a voice
// chosen on the desktop usually doesn't exist on the phone.
const VOICE_PREFS_STORAGE_KEY = 'linguaReadTtsVoices';

const readVoicePrefs = (): Record<string, string> => {
  try {
    const stored = localStorage.getItem(VOICE_PREFS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

export function getPreferredVoiceURI(languageCode: string | null | undefined): string | null {
  return readVoicePrefs()[toSpeechLanguageTag(languageCode)] ?? null;
}

export function setPreferredVoiceURI(
  languageCode: string | null | undefined,
  voiceURI: string | null
): void {
  const prefs = readVoicePrefs();
  const tag = toSpeechLanguageTag(languageCode);
  if (voiceURI) {
    prefs[tag] = voiceURI;
  } else {
    delete prefs[tag];
  }
  try {
    localStorage.setItem(VOICE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch (error) {
    console.error('Error saving TTS voice choice to localStorage:', error);
  }
}

// Chrome fills the voice list asynchronously; wait for it briefly.
function loadVoices(synth: SpeechSynthesis, timeoutMs: number): Promise<SpeechSynthesisVoice[]> {
  const voices = synth.getVoices();
  if (voices.length > 0) {
    return Promise.resolve(voices);
  }
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      window.clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = window.setTimeout(done, timeoutMs);
    synth.addEventListener('voiceschanged', done);
  });
}

/** Installed voices for a language, best first (for the voice picker). */
export async function getVoicesForLanguage(
  languageCode: string | null | undefined
): Promise<SpeechSynthesisVoice[]> {
  const synth = getSynth();
  if (!synth) {
    return [];
  }
  return rankVoices(await loadVoices(synth, 1000), toSpeechLanguageTag(languageCode));
}

export function cancelSpeech(): void {
  const synth = getSynth();
  if (synth) {
    synth.cancel();
  }
}

export type SpeakTextOptions = {
  text?: string | null;
  languageCode?: string | null;
  rate?: number | string | null;
  // Defaults to the voice chosen for this language in settings.
  voiceURI?: string | null;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
};

export function speakText({
  text,
  languageCode,
  rate,
  voiceURI,
  onStart,
  onEnd,
  onError
}: SpeakTextOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const synth = getSynth();
    if (!synth || typeof window.SpeechSynthesisUtterance === 'undefined') {
      const supportError = new Error('Speech synthesis is not supported in this browser.');
      onError?.(supportError);
      reject(supportError);
      return;
    }

    const trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!trimmedText) {
      resolve();
      return;
    }

    const speechLang = toSpeechLanguageTag(languageCode);
    const utterance = new window.SpeechSynthesisUtterance(trimmedText);
    utterance.lang = speechLang;
    utterance.rate = clampSpeechRate(rate);

    let didSpeak = false;

    const applyVoiceAndSpeak = () => {
      if (didSpeak) {
        return;
      }
      didSpeak = true;

      const preferred = voiceURI === undefined ? getPreferredVoiceURI(languageCode) : voiceURI;
      const voice = pickVoice(synth.getVoices(), speechLang, preferred);
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || speechLang;
      }

      utterance.onstart = () => onStart?.();
      utterance.onend = () => {
        onEnd?.();
        resolve();
      };
      utterance.onerror = (event) => {
        const speechError = new Error(event?.error || 'Speech synthesis failed.');
        onError?.(speechError);
        reject(speechError);
      };

      synth.cancel();
      synth.speak(utterance);
    };

    const voices = synth.getVoices();
    if (voices.length > 0) {
      applyVoiceAndSpeak();
      return;
    }

    const handleVoicesChanged = () => {
      synth.removeEventListener('voiceschanged', handleVoicesChanged);
      applyVoiceAndSpeak();
    };

    synth.addEventListener('voiceschanged', handleVoicesChanged);
    window.setTimeout(() => {
      synth.removeEventListener('voiceschanged', handleVoicesChanged);
      applyVoiceAndSpeak();
    }, 250);
  });
}
