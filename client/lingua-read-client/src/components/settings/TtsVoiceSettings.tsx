import React, { useEffect, useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import {
  getPreferredVoiceURI,
  getVoicesForLanguage,
  isNaturalVoice,
  setPreferredVoiceURI,
  speakText
} from '../../utils/browserTts';

interface VoiceLanguage {
  languageId: number;
  name: string;
  code?: string | null;
}

interface TtsVoiceSettingsProps {
  languages: VoiceLanguage[];
}

// Digits exist in every language, so the preview needs no sample text.
const PREVIEW_TEXT = '1, 2, 3, 4, 5';

const VoiceRow = ({ language }: { language: VoiceLanguage }) => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  const [voiceURI, setVoiceURI] = useState<string>(() => getPreferredVoiceURI(language.code) ?? '');

  useEffect(() => {
    let cancelled = false;
    getVoicesForLanguage(language.code).then((found) => {
      if (!cancelled) setVoices(found);
    });
    return () => {
      cancelled = true;
    };
  }, [language.code]);

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setVoiceURI(event.target.value);
    setPreferredVoiceURI(language.code, event.target.value || null);
  };

  const preview = () => {
    speakText({ text: PREVIEW_TEXT, languageCode: language.code, voiceURI: voiceURI || null }).catch(() => {});
  };

  const controlId = `tts-voice-${language.languageId}`;

  if (voices && voices.length === 0) {
    return (
      <Form.Group className="mb-2" controlId={controlId}>
        <Form.Label className="mb-0">{language.name}</Form.Label>
        <Form.Text className="d-block text-muted">
          No {language.name} voice on this device.
        </Form.Text>
      </Form.Group>
    );
  }

  return (
    <Form.Group className="mb-2" controlId={controlId}>
      <Form.Label className="mb-1">{language.name}</Form.Label>
      <div className="d-flex gap-2">
        <Form.Select size="sm" value={voiceURI} onChange={handleChange} disabled={voices === null}>
          <option value="">Automatic (best available)</option>
          {(voices ?? []).map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang}){isNaturalVoice(voice) ? ' · natural' : ''}
            </option>
          ))}
        </Form.Select>
        <Button
          size="sm"
          variant="outline-secondary"
          onClick={preview}
          disabled={voices === null}
          aria-label={`Preview ${language.name} voice`}
          title="Preview"
        >
          ▶
        </Button>
      </div>
    </Form.Group>
  );
};

/**
 * Per-language voice choice for browser text-to-speech. Stored on this device
 * only, because each device and browser has its own voices.
 */
const TtsVoiceSettings = ({ languages }: TtsVoiceSettingsProps) => {
  const withCodes = languages.filter((language) => language.code);
  if (withCodes.length === 0) return null;

  return (
    <div className="mt-3" data-testid="tts-voice-settings">
      <div className="fw-semibold mb-1">Voices on this device</div>
      <Form.Text className="d-block text-muted mb-2">
        Saved on this device only. For more voices: on Windows, Settings → Time &amp; language →
        Speech; on Android, the Google speech engine's voice data; on iOS, Accessibility → Spoken
        Content → Voices. On desktop, Edge has the most natural voices.
      </Form.Text>
      {withCodes.map((language) => (
        <VoiceRow key={language.languageId} language={language} />
      ))}
    </div>
  );
};

export default TtsVoiceSettings;
