import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cancelSpeech } from '../utils/browserTts';
import { getScrollBehavior } from '../utils/motion';
import { findSrtLineIndex } from '../utils/srtParser';
import type { SrtEntry } from '../utils/srtParser';

// SegmentPlaybackRequest lives with the segment-playback state machine in
// src/audio/segmentPlayback.ts. Re-exported here so existing consumers
// (LessonHeader, TextDisplay, etc.) don't need to update their imports.
import type { SegmentPlaybackRequest } from '../audio/segmentPlayback';
export type { SegmentPlaybackRequest };

// ReaderSegment + SrtSentenceSegment + SentenceSegment are co-located with the
// strict ReaderSegment producer (splitTextIntoSentenceSegments) in readerText.
// Re-exported here so consumers (SentenceModeView, etc.) keep working.
export type { ReaderSegment, SrtSentenceSegment, SentenceSegment } from '../utils/readerText';

// react-window's imperative list API we actually use. Typed against the
// library directly so consumers can pass a real list ref.
import type { ListImperativeAPI } from 'react-window';
type ListLikeRef = ListImperativeAPI | null;

export type UseReaderAudioSyncArgs = {
  isAudioLesson: boolean;
  isSentenceMode: boolean;
  isMobile: boolean;
  displayMode: string;
  srtLines: SrtEntry[];
  currentSegmentIndex: number;
  setCurrentSegmentIndex: React.Dispatch<React.SetStateAction<number>>;
  listRef: React.MutableRefObject<ListLikeRef>;
};

export type UseReaderAudioSyncResult = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  audioCurrentTimeRef: React.MutableRefObject<number>;
  currentSrtLineId: number | null;
  setCurrentSrtLineId: React.Dispatch<React.SetStateAction<number | null>>;
  isAudioPlaying: boolean;
  setIsAudioPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  isSpeakingSentence: boolean;
  setIsSpeakingSentence: React.Dispatch<React.SetStateAction<boolean>>;
  isSpeakingWord: boolean;
  setIsSpeakingWord: React.Dispatch<React.SetStateAction<boolean>>;
  segmentPlaybackRequest: SegmentPlaybackRequest | null;
  setSegmentPlaybackRequest: React.Dispatch<
    React.SetStateAction<SegmentPlaybackRequest | null>
  >;
  audioDrivenSentenceSyncRef: React.MutableRefObject<boolean>;
  lastAutoSegmentPlaybackKeyRef: React.MutableRefObject<string>;
  skipInitialAudioLessonSegmentPlaybackRef: React.MutableRefObject<boolean>;
  pendingSentenceCreditRef: React.MutableRefObject<Set<number>>;
  setAudioPlaybackIntent: (shouldPlay: boolean) => void;
  toggleAudioPlayback: () => void;
  pauseAudioPlayback: () => void;
  handleAudioPlaybackStateChange: (nextIsPlaying: boolean) => void;
  handleLineClick: (startTime: number) => void;
  handleAudioTimeUpdate: (newTime: number) => void;
};

type TimeUpdateSnapshot = {
  isAudioLesson: boolean;
  srtLines: SrtEntry[];
  displayMode: string;
  currentSrtLineId: number | null;
  isSentenceMode: boolean;
  isAudioPlaying: boolean;
  currentSegmentIndex: number;
  isMobile: boolean;
  listRef: React.MutableRefObject<ListLikeRef>;
};

export const useReaderAudioSync = ({
  isAudioLesson,
  isSentenceMode,
  isMobile,
  displayMode,
  srtLines,
  currentSegmentIndex,
  setCurrentSegmentIndex,
  listRef
}: UseReaderAudioSyncArgs): UseReaderAudioSyncResult => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCurrentTimeRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);

  const [currentSrtLineId, setCurrentSrtLineId] = useState<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [isSpeakingSentence, setIsSpeakingSentence] = useState(false);
  const [isSpeakingWord, setIsSpeakingWord] = useState(false);
  const [segmentPlaybackRequest, setSegmentPlaybackRequest] =
    useState<SegmentPlaybackRequest | null>(null);

  const audioDrivenSentenceSyncRef = useRef(false);
  const lastAutoSegmentPlaybackKeyRef = useRef('');
  const skipInitialAudioLessonSegmentPlaybackRef = useRef(true);
  const pendingSentenceCreditRef = useRef(new Set<number>());

  const previousSegmentIndexRef = useRef(currentSegmentIndex);
  const wasSentenceModeRef = useRef(isSentenceMode);
  const lastAudioDrivenTargetRef = useRef<number | null>(null);
  const manualTargetRef = useRef<{ segmentIndex: number; reached: boolean; setAt: number } | null>(null);
  const lastTrackedRequestIdRef = useRef<string | null>(null);

  const timeUpdateSnapshotRef = useRef<TimeUpdateSnapshot>({
    isAudioLesson: false,
    srtLines: [],
    displayMode: 'audio',
    currentSrtLineId: null,
    isSentenceMode: false,
    isAudioPlaying: false,
    currentSegmentIndex: 0,
    isMobile: false,
    listRef
  });

  useEffect(() => {
    timeUpdateSnapshotRef.current = {
      isAudioLesson,
      srtLines,
      displayMode,
      currentSrtLineId,
      isSentenceMode,
      isAudioPlaying,
      currentSegmentIndex,
      isMobile,
      listRef
    };
  }, [
    isAudioLesson,
    srtLines,
    displayMode,
    currentSrtLineId,
    isSentenceMode,
    isAudioPlaying,
    currentSegmentIndex,
    isMobile,
    listRef
  ]);

  useEffect(() => {
    const prevSegmentIndex = previousSegmentIndexRef.current;
    const wasSentenceMode = wasSentenceModeRef.current;
    previousSegmentIndexRef.current = currentSegmentIndex;
    wasSentenceModeRef.current = isSentenceMode;

    if (!isAudioLesson || !isSentenceMode) {
      manualTargetRef.current = null;
      lastAudioDrivenTargetRef.current = null;
      lastTrackedRequestIdRef.current = null;
      return;
    }

    const isAudioDrivenMatch =
      audioDrivenSentenceSyncRef.current &&
      lastAudioDrivenTargetRef.current === currentSegmentIndex;
    if (isAudioDrivenMatch) {
      lastAudioDrivenTargetRef.current = null;
      return;
    }

    if (
      wasSentenceMode &&
      currentSegmentIndex !== prevSegmentIndex &&
      !skipInitialAudioLessonSegmentPlaybackRef.current
    ) {
      manualTargetRef.current = {
        segmentIndex: currentSegmentIndex,
        reached: false,
        setAt: Date.now()
      };
    }
  }, [currentSegmentIndex, isAudioLesson, isSentenceMode]);

  useEffect(() => {
    const requestId = segmentPlaybackRequest?.requestId ?? null;
    if (!requestId) {
      if (lastTrackedRequestIdRef.current !== null) {
        lastTrackedRequestIdRef.current = null;
        if (manualTargetRef.current && !manualTargetRef.current.reached) {
          manualTargetRef.current = null;
        }
      }
      return;
    }

    if (!isAudioLesson || !isSentenceMode || srtLines.length === 0 || !segmentPlaybackRequest) {
      return;
    }

    if (requestId === lastTrackedRequestIdRef.current) {
      return;
    }
    lastTrackedRequestIdRef.current = requestId;

    const currentLine = srtLines[currentSegmentIndex];
    const matchedIndex =
      currentLine &&
      Math.abs(currentLine.startTime - segmentPlaybackRequest.startTime) < 0.05 &&
      Math.abs(currentLine.endTime - segmentPlaybackRequest.endTime) < 0.05
        ? currentSegmentIndex
        : findSrtLineIndex(srtLines, segmentPlaybackRequest.startTime);

    if (matchedIndex !== -1) {
      manualTargetRef.current = {
        segmentIndex: matchedIndex,
        reached: false,
        setAt: Date.now()
      };
    }
  }, [segmentPlaybackRequest, isAudioLesson, isSentenceMode, srtLines, currentSegmentIndex]);

  useEffect(() => {
    if (!isSentenceMode) {
      cancelSpeech();
      setIsSpeakingSentence(false);
      setIsSpeakingWord(false);
      lastAutoSegmentPlaybackKeyRef.current = '';
      setSegmentPlaybackRequest(null);
    }
  }, [isSentenceMode]);

  useEffect(
    () => () => {
      cancelSpeech();
    },
    []
  );

  useEffect(() => {
    cancelSpeech();
    setIsSpeakingSentence(false);
    setIsSpeakingWord(false);
  }, [currentSegmentIndex]);

  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    };
  }, []);

  const setAudioPlaybackIntent = useCallback((shouldPlay: boolean) => {
    if (audioRef.current) {
      // __lrAllowPlayback is a runtime intent flag the AudiobookPlayer reads
      // to distinguish user-driven playback from autoplay attempts. Typed
      // locally rather than globally to keep the augmentation contained.
      (audioRef.current as HTMLAudioElement & { __lrAllowPlayback?: boolean }).__lrAllowPlayback = shouldPlay;
    }
  }, []);

  const toggleAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setAudioPlaybackIntent(true);
      audio.play().catch((err: unknown) =>
        console.error('Mobile audio toggle failed to play:', err)
      );
    } else {
      setAudioPlaybackIntent(false);
      audio.pause();
    }
  }, [setAudioPlaybackIntent]);

  const pauseAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    setAudioPlaybackIntent(false);
    audio.pause();
  }, [setAudioPlaybackIntent]);

  const handleAudioPlaybackStateChange = useCallback((nextIsPlaying: boolean) => {
    if (nextIsPlaying) {
      cancelSpeech();
      setIsSpeakingSentence(false);
      setIsSpeakingWord(false);
    }
    setIsAudioPlaying(nextIsPlaying);
  }, []);

  const handleLineClick = useCallback(
    (startTime: number) => {
      if (audioRef.current) {
        audioRef.current.currentTime = startTime;
        audioCurrentTimeRef.current = startTime;
        manualTargetRef.current = null;

        if (isAudioLesson && displayMode === 'audio' && srtLines.length > 0) {
          const currentLineIndex = findSrtLineIndex(srtLines, startTime);
          const currentLine = currentLineIndex !== -1 ? srtLines[currentLineIndex] : null;
          setCurrentSrtLineId(currentLine?.id ?? null);

          if (currentLineIndex !== -1 && currentLineIndex !== currentSegmentIndex) {
            if (isSentenceMode) {
              audioDrivenSentenceSyncRef.current = true;
              lastAudioDrivenTargetRef.current = currentLineIndex;
            }
            setCurrentSegmentIndex(currentLineIndex);
          }
        }
      }
    },
    [
      currentSegmentIndex,
      displayMode,
      isAudioLesson,
      isSentenceMode,
      srtLines,
      setCurrentSegmentIndex
    ]
  );

  const handleAudioTimeUpdate = useCallback((newTime: number) => {
    const snapshot = timeUpdateSnapshotRef.current;
    const {
      isAudioLesson: snapIsAudioLesson,
      srtLines: snapSrtLines,
      displayMode: snapDisplayMode,
      currentSrtLineId: snapCurrentSrtLineId,
      isSentenceMode: snapIsSentenceMode,
      isAudioPlaying: snapIsAudioPlaying,
      currentSegmentIndex: snapCurrentSegmentIndex,
      isMobile: snapIsMobile,
      listRef: snapListRef
    } = snapshot;

    audioCurrentTimeRef.current = newTime;

    if (!snapIsAudioLesson || snapSrtLines.length === 0 || (!snapIsSentenceMode && snapDisplayMode !== 'audio')) {
      if (snapCurrentSrtLineId !== null) setCurrentSrtLineId(null);
      return;
    }

    const currentLineIndex = findSrtLineIndex(snapSrtLines, newTime);
    const currentLine = currentLineIndex !== -1 ? snapSrtLines[currentLineIndex] : null;

    const target = snapIsSentenceMode ? manualTargetRef.current : null;
    if (snapIsSentenceMode && target !== null) {
      let activeTarget = target;
      const targetLine = snapSrtLines[activeTarget.segmentIndex];
      if (!targetLine) {
        manualTargetRef.current = null;
      } else {
        if (!activeTarget.reached) {
          const isShortCue = targetLine.endTime - targetLine.startTime <= 0.15;
          const isPaused = audioRef.current?.paused !== false;
          const arrived =
            newTime >= targetLine.startTime - 0.15 &&
            (isShortCue || isPaused ? newTime <= targetLine.endTime : newTime < targetLine.endTime);

          if (!arrived) {
            const elapsedSinceSet = Date.now() - activeTarget.setAt;
            const isSeeking = Boolean(audioRef.current?.seeking);
            if (isSeeking || elapsedSinceSet < 1200) {
              return;
            }
            manualTargetRef.current = null;
          } else {
            activeTarget = { ...activeTarget, reached: true };
            manualTargetRef.current = activeTarget;
          }
        }

        if (manualTargetRef.current === activeTarget && activeTarget.reached) {
          const inTargetOrBoundary =
            newTime >= targetLine.startTime - 0.15 &&
            newTime <= targetLine.endTime + 0.05;

          if (inTargetOrBoundary) {
            const isPreStartQuantization = newTime < targetLine.startTime;
            const isAtEndBoundaryWhileStopping =
              newTime >= targetLine.endTime - 0.05 &&
              (audioRef.current?.paused !== false || !snapIsAudioPlaying);

            if (
              isPreStartQuantization ||
              isAtEndBoundaryWhileStopping ||
              currentLineIndex === target.segmentIndex
            ) {
              if (snapCurrentSegmentIndex !== target.segmentIndex) {
                audioDrivenSentenceSyncRef.current = true;
                lastAudioDrivenTargetRef.current = target.segmentIndex;
                setCurrentSegmentIndex(target.segmentIndex);
              }
              if (targetLine.id !== snapCurrentSrtLineId) {
                setCurrentSrtLineId(targetLine.id);
              }
              return;
            }

            if (
              newTime >= targetLine.endTime &&
              audioRef.current?.paused === false &&
              snapIsAudioPlaying
            ) {
              manualTargetRef.current = null;
            }
          } else {
            manualTargetRef.current = null;
          }
        }
      }
    }

    if (
      snapIsSentenceMode &&
      currentLineIndex !== -1 &&
      currentLineIndex !== snapCurrentSegmentIndex
    ) {
      audioDrivenSentenceSyncRef.current = true;
      lastAudioDrivenTargetRef.current = currentLineIndex;
      setCurrentSegmentIndex(currentLineIndex);
    }

    if (currentLine && currentLine.id !== snapCurrentSrtLineId) {
      setCurrentSrtLineId(currentLine.id);

      if (snapIsSentenceMode) return;

      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
      autoScrollRafRef.current = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
        if (selection && !selection.isCollapsed && anchor?.closest('.audio-transcript-container')) return;
        if (!snapIsMobile && snapListRef?.current && currentLineIndex !== -1) {
          snapListRef.current.scrollToRow({ index: currentLineIndex, align: 'center' });
          return;
        }
        if (snapIsMobile) {
          const lineElement = document.getElementById(`srt-line-${currentLine.id}`);
          if (!lineElement) return;
          const rect = lineElement.getBoundingClientRect();
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
          const center = rect.top + rect.height / 2;
          if (Math.abs(center - viewportHeight / 2) > Math.max(12, viewportHeight * 0.05)) {
            lineElement.scrollIntoView({ block: 'center', behavior: getScrollBehavior() });
          }
        }
      });
    } else if (!currentLine && snapCurrentSrtLineId !== null) {
      setCurrentSrtLineId(null);
    }
  }, [setCurrentSegmentIndex]);

  return {
    audioRef,
    audioCurrentTimeRef,
    currentSrtLineId,
    setCurrentSrtLineId,
    isAudioPlaying,
    setIsAudioPlaying,
    isSpeakingSentence,
    setIsSpeakingSentence,
    isSpeakingWord,
    setIsSpeakingWord,
    segmentPlaybackRequest,
    setSegmentPlaybackRequest,
    audioDrivenSentenceSyncRef,
    lastAutoSegmentPlaybackKeyRef,
    skipInitialAudioLessonSegmentPlaybackRef,
    pendingSentenceCreditRef,
    setAudioPlaybackIntent,
    toggleAudioPlayback,
    pauseAudioPlayback,
    handleAudioPlaybackStateChange,
    handleLineClick,
    handleAudioTimeUpdate
  };
};
