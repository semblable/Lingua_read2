import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import type { ListImperativeAPI } from 'react-window';
import StandardTextView from '../../src/components/reader/StandardTextView';
import SentenceModeView from '../../src/components/reader/SentenceModeView';
import AudioTranscriptView from '../../src/components/reader/AudioTranscriptView';
import { mergeSettings } from '../../src/contexts/SettingsContext';
import { useReaderInteraction } from '../../src/hooks/useReaderInteraction';
import type { ReaderStatusIntent } from '../../src/utils/readerInteraction';
import { WORD_STATUS_LABELS } from '../../src/types/wordStatus';
import type { WordStatus } from '../../src/types/wordStatus';
import { buildSpikePassage } from './interactionData';
import type { SpikeScenario } from './interactionData';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fontsource/inter/400.css';
import '@fontsource/lora/400.css';
import '../../src/index.css';
import '../../src/pages/TextDisplay.css';
import './interaction.css';

const statusLabel = (status: number) => status === 0 ? 'Untracked' : WORD_STATUS_LABELS[status as WordStatus];
const settings = mergeSettings({ autoTranslateWords: false, autoTranslateOnOpen: false, textSize: 20, readerParagraphIndent: false });
const noAction = () => {};

// eslint-disable-next-line react-refresh/only-export-components -- Isolated browser spike entry.
function LookupDialog({ term, close, children }: { term: string; close: () => void; children: React.ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const background = document.getElementById('root')!;
    const wasInert = background.inert;
    background.inert = true;
    dialog.current?.querySelector('button')?.focus();
    return () => { background.inert = wasInert; };
  }, []);
  return createPortal(<div className="spike-modal-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="spike-lookup-title"
    className="spike-dialog" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button,input'));
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)!.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }
    }}>
    <h2 id="spike-lookup-title">Lookup: {term}</h2>
    <p>Authored lookup placeholder. Opening this dialog never calls a translation service.</p>
    <button onClick={close}>Close lookup</button>
    <label>Lookup notes <input /></label>
    {children}
  </div></div>, document.body);
}

// eslint-disable-next-line react-refresh/only-export-components -- Isolated browser spike entry.
function Passage({ scenario, view, revision }: { scenario: SpikeScenario; view: string; revision: number }) {
  const generation = `synthetic:${scenario}:${view}:${revision}`;
  const passage = useMemo(() => buildSpikePassage(generation, scenario), [generation, scenario]);
  const [statuses, setStatuses] = useState(passage.initialStatuses);
  const [feedback, setFeedback] = useState({ generation, message: 'No saves yet.' });
  const [failed, setFailed] = useState<ReaderStatusIntent | null>(null);
  const [characterShortcuts, setCharacterShortcuts] = useState(true);
  const [markers, setMarkers] = useState('current');
  const [rerenders, setRerenders] = useState(0);
  const [seekCount, setSeekCount] = useState(0);
  const [currentCue, setCurrentCue] = useState<number | null>(null);
  const [continuousReading, setContinuousReading] = useState(false);
  const [followDeferred, setFollowDeferred] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const readingRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ListImperativeAPI>(null);
  const sequence = useRef(0);
  const latest = useRef(new Map<string, number>());
  const alive = useRef(true);
  const currentGeneration = useRef(generation);
  const activeOccurrences = useMemo(() => view === 'sentence' && scenario !== 'transcript' ?
    passage.occurrences.filter(occurrence => occurrence.blockId === passage.blocks[0].id) : passage.occurrences, [passage, scenario, view]);
  useLayoutEffect(() => { currentGeneration.current = generation; }, [generation]);
  useEffect(() => () => { alive.current = false; }, []);
  const save = async (intent: ReaderStatusIntent) => {
    const request = ++sequence.current;
    latest.current.set(intent.entityKey, request);
    setStatuses(current => ({ ...current, [intent.entityKey]: intent.status }));
    setFeedback({ generation: intent.generation, message: `${intent.term}: ${statusLabel(intent.status)} — pending synthetic save.` });
    try {
      const response = await fetch('/api/interaction-fixture/status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(intent),
      });
      if (!response.ok) throw new Error('Synthetic save rejected');
      if (!alive.current || currentGeneration.current !== intent.generation || latest.current.get(intent.entityKey) !== request) return;
      setFeedback({ generation: intent.generation, message: `${intent.term}: ${statusLabel(intent.status)} — synthetic save confirmed.` });
      setFailed(null);
    } catch {
      if (!alive.current || currentGeneration.current !== intent.generation || latest.current.get(intent.entityKey) !== request) return;
      setFeedback({ generation: intent.generation, message: `Could not save ${intent.term}. Retry the synthetic save.` });
      setFailed(intent);
    }
  };
  const reader = useReaderInteraction({ generation, occurrences: activeOccurrences, direction: passage.direction,
    instructionsId: 'spike-instructions', targetDescriptionId: 'spike-target-description', characterShortcutsEnabled: characterShortcuts, onStatusIntent: save,
    ensureOccurrenceMounted: async (occurrence, signal) => {
      const index = passage.blocks.findIndex(block => block.id === occurrence.blockId);
      listRef.current?.scrollToRow({ index, align: 'center' });
      const deadline = performance.now() + 2500;
      while (!signal.aborted && performance.now() < deadline) {
        if (Array.from(document.querySelectorAll<HTMLElement>('[data-reader-occurrence]')).some(node => node.dataset.readerOccurrence === occurrence.id)) return;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
    },
  });
  const target = reader.shortcutTarget;
  const focused = reader.state.occurrences.find(unit => unit.id === reader.state.keyboardId);
  const renderContent = (text: string) => {
    // The real renderer passes whole source blocks/cues. No repeated-term search.
    const block = passage.blocks.find(candidate => candidate.text === text);
    if (!block) throw new Error(`Unexpected synthetic rendering boundary: ${text}`);
    return block.pieces.map((piece, index) => {
      if (!piece.occurrence) return <React.Fragment key={`separator-${index}`}>{piece.text}</React.Fragment>;
      const occurrence = piece.occurrence;
      const status = statuses[occurrence.entityKey] ?? passage.initialStatuses[occurrence.entityKey] ?? 0;
      return <span key={occurrence.id} {...reader.getOccurrenceProps(occurrence)} lang={occurrence.languageCode}
        className={`clickable-word word-status-${status} spike-word${target?.id === occurrence.id ? ' spike-shortcut-target' : ''}`}
        data-status={status} data-source-block={occurrence.blockId} data-source-start={occurrence.start}
        data-marker={status === 0 ? '○' : status <= 4 ? String(status) : undefined}
        title={`${occurrence.term}: ${statusLabel(status)}`}>{piece.text}</span>;
    });
  };
  const isTranscript = scenario === 'transcript';
  const first = passage.blocks[0];
  const saveFeedback = <>
    <p role="status" aria-live="polite" aria-atomic="true" data-testid="save-feedback">{feedback.generation === generation ? feedback.message : 'No saves yet.'}</p>
    {failed?.generation === generation && <button onClick={() => { void save(failed); }}>Retry synthetic save</button>}
  </>;
  return <>
    <div inert={reader.isLookupOpen || undefined}>
      <p className="spike-gate">Experimental interaction semantics. Screen-reader reading flow, key delivery and speech remain unverified. Synthetic data and saves only.</p>
      <div className="spike-options">
        <label>Marker candidate <select value={markers} onChange={event => setMarkers(event.target.value)}>
          <option value="current">Current color presentation</option><option value="stages">Four learning-stage decorations</option>
          <option value="stronger">Stronger complete opt-in candidate</option>
        </select></label>
        <label><input type="checkbox" checked={characterShortcuts} onChange={event => setCharacterShortcuts(event.target.checked)} /> Character status shortcuts</label>
        {isTranscript && <label><input type="checkbox" checked={continuousReading} onChange={event => setContinuousReading(event.target.checked)} /> Full transcript reading comparison</label>}
        <button onClick={() => setRerenders(value => value + 1)}>Rerender styles</button>
        {isTranscript && <button onClick={() => {
          // Simulate playback follow without seeking/playing; never move DOM focus.
          setCurrentCue(80);
          const interacting = reader.state.mode !== 'reading';
          setFollowDeferred(interacting);
          if (!interacting) listRef.current?.scrollToRow({ index: 79, align: 'center' });
        }}>Simulate playback follow</button>}
      </div>
      <p id="spike-instructions">Tab into the passage or choose Interact with words. Left/Right move in logical reading order ({passage.direction.toUpperCase()}). Enter opens lookup. Escape returns to reading. Tab leaves naturally. Status keys: 1–5 and I. Native controls below provide the same actions.</p>
      <div className="spike-controls" role="group" aria-label="Word interaction controls">
        <button onClick={() => reader.enter()}>Interact with words</button>
        <button onClick={() => reader.move(-1, false)}>Previous word</button>
        <button onClick={() => reader.move(1, false)}>Next word</button>
        <label>Set target status <select aria-label="Set target status" aria-describedby="spike-target-description" value="" disabled={!target && !focused}
          onFocus={() => reader.enter(false)} onChange={event => {
          reader.enter(false); reader.setStatus(Number(event.target.value) as WordStatus);
        }}>
          <option value="" disabled>Choose status</option>{([1, 2, 3, 4, 5, 6] as const).map(status => <option key={status} value={status}>{WORD_STATUS_LABELS[status]}</option>)}
        </select></label>
        <button disabled={!target && !focused} aria-describedby="spike-target-description" onFocus={() => reader.enter(false)}
          onClick={() => { reader.enter(false); reader.openLookup(); }}>Look up target</button>
        <button onClick={() => reader.exit()}>Exit word interaction</button>
      </div>
      <p className="spike-target" id="spike-target-description" data-testid="target-description">Target: {target ? `${target.term} · ${statusLabel(statuses[target.entityKey] ?? passage.initialStatuses[target.entityKey] ?? 0)}` : 'none'}<br />
        Focus anchor: {focused?.term ?? 'none'} · Mode: <span data-testid="interaction-mode">{reader.state.mode}</span> · Owner: <span data-testid="input-owner">{reader.state.inputOwner}</span></p>
      <div className={`spike-markers-${markers}`}>
        <div {...reader.passageProps} data-testid="interaction-passage" className="spike-passage" dir={passage.direction}>
          <div ref={readingRef} className="spike-real-renderer">
            {isTranscript ? <AudioTranscriptView isMobile={continuousReading} srtLines={passage.blocks.map((block, index) => ({ id: index + 1, text: block.text, startTime: index * 2, endTime: index * 2 + 2 }))}
              currentSrtLineId={currentCue} getFontStyling={lineHeight => ({ fontSize: 20, lineHeight })}
              handleLineClick={() => setSeekCount(value => value + 1)} handleWordSelection={noAction} processTextContent={renderContent}
              globalSettings={settings} mobileReadingConfig={{ lineSpacing: 1.8, blockPadding: 0 }} textContentRef={contentRef}
              readingContainerRef={readingRef} listRef={listRef} languageCode="en" rightToLeft={false} /> :
              view === 'sentence' ? <SentenceModeView currentSegment={{ index: 0, text: first.text, type: 'sentence', mediaBlocks: [] }}
                segmentCount={1} currentSegmentIndex={0} creditedSegmentCount={0} fontStyle={{ fontSize: 20 }} processTextContent={renderContent}
                handleWordSelection={noAction} textContentRef={contentRef} canGoPrev={false} canGoNext={false} onPrev={noAction} onNext={noAction}
                onReplayAudio={noAction} canUseSentenceTts={false} isSpeakingSentence={false} sentenceTtsEnabled={false} setSentenceTtsEnabled={noAction}
                sentenceTtsRate={1} setSentenceTtsRate={noAction} isAudioLesson={false} sentenceAudioRepeats={1} setSentenceAudioRepeats={noAction}
                onShowTranslation={noAction} onShowExplanation={noAction} isTranslatingSegment={false} isExplainingSegment={false}
                isTranslationVisible={false} isExplanationVisible={false} currentSegmentTranslation="" currentSegmentExplanation=""
                languageCode={first.languageCode} rightToLeft={passage.direction === 'rtl'} /> :
              <StandardTextView text={{ textId: 9901, title: 'Authored interaction passage', content: passage.blocks.map(block => block.text).join('\n\n'), languageId: 1, languageCode: first.languageCode, words: [] }}
                globalSettings={settings} readingUiMode="classic" mobileReadingConfig={{ lineSpacing: 1.8, blockPadding: 0, chunkSize: 3 }}
                getFontFamilyForList={() => 'var(--font-family-serif)'} handleWordSelection={noAction} processTextContent={renderContent}
                renderSentence={processed => processed} isMobile={false} textContentRef={contentRef} canUseSentenceTts={false} isSpeakingSentence={false}
                sentenceTtsEnabled={false} setSentenceTtsEnabled={noAction} sentenceTtsRate={1} setSentenceTtsRate={noAction} onSpeakSentence={noAction}
                handleCompleteLesson={noAction} completing={false} rightToLeft={passage.direction === 'rtl'} />}
          </div>
        </div>
      </div>
      <button data-testid="after-passage">After passage</button>
      <label>Native notes <input aria-label="Native notes" /></label>
      {!reader.isLookupOpen && saveFeedback}
      <p data-testid="spike-diagnostics">{activeOccurrences.length} registered occurrences; {rerenders} style rerenders; {seekCount} seeks. {followDeferred ? 'Playback follow deferred for interaction.' : ''}</p>
    </div>
    {reader.isLookupOpen && <LookupDialog term={reader.lookupTarget?.term ?? ''} close={reader.closeLookup}>{saveFeedback}</LookupDialog>}
  </>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Isolated browser spike entry.
function InteractionSpike() {
  const query = new URLSearchParams(window.location.search);
  const [scenario, setScenario] = useState<SpikeScenario>((query.get('scenario') || 'mixed') as SpikeScenario);
  const [view, setView] = useState('paragraph');
  const [revision, setRevision] = useState(1);
  return <main className="interaction-spike">
    <h1>Reader interaction experiment</h1>
    <p>Isolated evidence harness · authored content · no production integration</p>
    <div className="spike-options">
      <label>Passage <select value={scenario} onChange={event => setScenario(event.target.value as SpikeScenario)}>
        <option value="mixed">Mixed statuses and scripts</option><option value="first-read">Mostly Untracked first read</option>
        <option value="rtl">Arabic / Hebrew source order</option><option value="korean">Korean phrase alias</option>
        <option value="transcript">Long virtualized transcript</option>
      </select></label>
      <label>Presentation <select value={view} onChange={event => setView(event.target.value)}><option value="paragraph">Paragraph</option><option value="sentence">Sentence</option></select></label>
      <button onClick={() => setRevision(value => value + 1)}>Replace passage generation</button>
    </div>
    <Passage scenario={scenario} view={view} revision={revision} />
  </main>;
}

createRoot(document.getElementById('root')!).render(<InteractionSpike />);
