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

function pickVoice(
  voices: SpeechSynthesisVoice[] | null | undefined,
  speechLang: string
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) {
    return null;
  }

  const normalizedLang = speechLang.toLowerCase();
  const baseLanguage = normalizedLang.split('-')[0];

  return (
    voices.find((voice) => voice.lang?.toLowerCase() === normalizedLang) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith(`${normalizedLang}-`)) ||
    voices.find((voice) => voice.lang?.toLowerCase().startsWith(`${baseLanguage}-`)) ||
    voices.find((voice) => voice.lang?.toLowerCase() === baseLanguage) ||
    voices.find((voice) => voice.default) ||
    null
  );
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
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
};

export function speakText({
  text,
  languageCode,
  rate,
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

      const voice = pickVoice(synth.getVoices(), speechLang);
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
