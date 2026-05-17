import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cancelSpeech } from '../utils/browserTts';
import { findSrtLineIndex } from '../utils/srtParser';
import type { SrtEntry } from '../utils/srtParser';

export type SegmentPlaybackRequest = {
  requestId: string;
  startTime: number;
  endTime: number;
  repeatCount: number;
  forcePlay: boolean;
};

export type SrtSegment = {
  kind: 'srt';
  index: number;
  text: string;
  startTime: number;
  endTime: number;
  srtLineId: number;
  type: 'audio';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SplitSegment = Record<string, any> & {
  kind?: 'split';
  index: number;
  text: string;
  startTime?: null;
  endTime?: null;
};

export type ReaderSegment = SrtSegment | SplitSegment;

// react-window's FixedSizeList ref shape we actually use.
type ListLikeRef = {
  scrollToItem: (index: number, align?: string) => void;
} | null;

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
  audioRef: React.RefObject<HTMLAudioElement>;
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

  const timeUpdateSnapshotRef = useRef<TimeUpdateSnapshot>({
    isAudioLesson: false,
    srtLines: [],
    displayMode: 'audio',
    currentSrtLineId: null,
    isSentenceMode: false,
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
    currentSegmentIndex,
    isMobile,
    listRef
  ]);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRef.current as any).__lrAllowPlayback = shouldPlay;
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

        if (isAudioLesson && displayMode === 'audio' && srtLines.length > 0) {
          const currentLineIndex = srtLines.findIndex(
            line => startTime >= line.startTime && startTime < line.endTime
          );
          const currentLine = currentLineIndex !== -1 ? srtLines[currentLineIndex] : null;
          setCurrentSrtLineId(currentLine?.id ?? null);

          if (
            isSentenceMode &&
            currentLineIndex !== -1 &&
            currentLineIndex !== currentSegmentIndex
          ) {
            audioDrivenSentenceSyncRef.current = true;
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
      currentSegmentIndex: snapCurrentSegmentIndex,
      isMobile: snapIsMobile,
      listRef: snapListRef
    } = snapshot;

    audioCurrentTimeRef.current = newTime;

    if (!snapIsAudioLesson || snapSrtLines.length === 0 || snapDisplayMode !== 'audio') {
      if (snapCurrentSrtLineId !== null) setCurrentSrtLineId(null);
      return;
    }

    const currentLineIndex = findSrtLineIndex(snapSrtLines, newTime);
    const currentLine = currentLineIndex !== -1 ? snapSrtLines[currentLineIndex] : null;

    if (
      snapIsSentenceMode &&
      currentLineIndex !== -1 &&
      currentLineIndex !== snapCurrentSegmentIndex
    ) {
      audioDrivenSentenceSyncRef.current = true;
      setCurrentSegmentIndex(currentLineIndex);
    }

    if (currentLine && currentLine.id !== snapCurrentSrtLineId) {
      setCurrentSrtLineId(currentLine.id);

      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
      autoScrollRafRef.current = requestAnimationFrame(() => {
        if (!snapIsMobile && snapListRef?.current && currentLineIndex !== -1) {
          snapListRef.current.scrollToItem(currentLineIndex, 'center');
          return;
        }
        if (snapIsMobile) {
          const lineElement = document.getElementById(`srt-line-${currentLine.id}`);
          if (!lineElement) return;
          const rect = lineElement.getBoundingClientRect();
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
          const upperBound = viewportHeight * 0.3;
          const lowerBound = viewportHeight * 0.6;
          if (rect.top < upperBound || rect.bottom > lowerBound) {
            lineElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
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
