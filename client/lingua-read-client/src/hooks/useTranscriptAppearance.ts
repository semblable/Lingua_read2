import { useEffect, useState } from 'react';
import {
  AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY, AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, readTranscriptAlignments,
  type TranscriptAlignment, type TranscriptLayout,
} from '../utils/audioTranscript';
import storage from '../utils/storage';

const appearanceEvent = 'linguaread:transcript-appearance';
const readAppearance = () => ({
  layout: storage.getItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY) === 'flow' ? 'flow' as const : 'cues' as const,
  alignments: readTranscriptAlignments(),
});

// The toolbar and transcript share persisted preferences. Same-tab changes
// notify both; native storage events keep other open tabs in sync.
export function useTranscriptAppearance() {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    const refresh = () => setAppearance(readAppearance());
    window.addEventListener(appearanceEvent, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(appearanceEvent, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
  return {
    layout: appearance.layout,
    alignment: appearance.alignments[appearance.layout],
    setLayout: (layout: TranscriptLayout) => {
      storage.setItem(AUDIO_TRANSCRIPT_LAYOUT_STORAGE_KEY, layout);
      window.dispatchEvent(new Event(appearanceEvent));
    },
    setAlignment: (alignment: TranscriptAlignment) => {
      const current = readAppearance();
      storage.setItem(AUDIO_TRANSCRIPT_ALIGNMENT_STORAGE_KEY,
        JSON.stringify({ ...current.alignments, [current.layout]: alignment }));
      window.dispatchEvent(new Event(appearanceEvent));
    },
  };
}
