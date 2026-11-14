import { useRef, type ReactNode } from 'react';
import SentenceModeView from '../../src/components/reader/SentenceModeView';
import { consumeWordAt, prepareLanguageContext } from '../../src/utils/readerText';
import type { Settings } from '../../src/contexts/SettingsContext';

const sentence = 'Éloïse suit la rivière. Le soleil éclaire les petites maisons.';
const statuses: Record<string, number> = { Éloïse: 1, suit: 2, rivière: 3, soleil: 4, maisons: 5, Le: 6 };
const noop = () => {};

/** Production sentence presentation with inert action adapters. Mounting the full
 * reader in sentence mode intentionally records progress, which layout must not do. */
export default function SentenceLayoutFixture({ settings }: { settings: Settings }) {
  const textContentRef = useRef<HTMLDivElement>(null);
  const mixed = new URLSearchParams(window.location.search).get('mixed') === '1';
  const renderWords = (value: string): ReactNode => {
    const { processed, coreRegex, wordEnds } = prepareLanguageContext(value, { code: 'fr' });
    const pieces: ReactNode[] = [];
    for (let index = 0; index < processed.length;) {
      const token = consumeWordAt(processed, index, coreRegex, wordEnds);
      if (token) {
        const term = processed.slice(index, token.end);
        pieces.push(<span key={index} className={`clickable-word word-status-${mixed ? statuses[term] ?? 0 : 0}`}>{term}</span>);
        index = token.end;
      } else {
        const width = processed.codePointAt(index)! > 0xffff ? 2 : 1;
        pieces.push(processed.slice(index, index + width));
        index += width;
      }
    }
    return pieces;
  };
  return <div className={`text-display-wrapper reader-ui-${settings.readingUiMode} p-3`}>
    <p className="small">Read-only sentence appearance fixture · synthetic text</p>
    <SentenceModeView currentSegment={{ index: 0, text: sentence, type: 'sentence', mediaBlocks: [] }} segmentCount={2}
      currentSegmentIndex={0} creditedSegmentCount={0} textContentRef={textContentRef}
      fontStyle={{ fontSize: settings.textSize, lineHeight: settings.lineSpacing }} processTextContent={renderWords}
      handleWordSelection={noop} canGoPrev={false} canGoNext onPrev={noop} onNext={noop} onReplayAudio={noop}
      canUseSentenceTts={false} isSpeakingSentence={false} sentenceTtsEnabled={false} setSentenceTtsEnabled={noop}
      sentenceTtsRate={1} setSentenceTtsRate={noop} isAudioLesson={false} sentenceAudioRepeats={1}
      setSentenceAudioRepeats={noop} onShowTranslation={noop} onShowExplanation={noop} isTranslatingSegment={false}
      isExplainingSegment={false} isTranslationVisible={false} isExplanationVisible={false}
      currentSegmentTranslation="" currentSegmentExplanation="" languageCode="fr" />
  </div>;
}
