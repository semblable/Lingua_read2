import type { RecentTexts } from '../../utils/api/texts';

export const resumeTitle = (text: RecentTexts[number]): string => text.bookTitle
  ? `${text.bookTitle}${text.partNumber ? ` · Part ${text.partNumber}` : ''}`
  : text.title || 'Untitled';

export const formatPosition = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${String(whole % 60).padStart(2, '0')}`;
};

export const relativeTime = (iso?: string | null): string | null => {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

export const resumeSummary = (text: RecentTexts[number]) => {
  if (text.isAudioLesson) {
    const duration = text.audioDurationSeconds;
    const position = text.audioPositionSeconds;
    const hasPosition = position != null && Number.isFinite(position) && position >= 0;
    return {
      percent: hasPosition && duration && duration > 0 ? Math.min(100, Math.round(position / duration * 100)) : null,
      label: 'Listening position',
      position: hasPosition ? `${formatPosition(position)} into audio` : 'Ready to listen',
      eta: hasPosition && duration && duration > position ? `~${Math.max(1, Math.ceil((duration - position) / 60))} min left` : null,
    };
  }
  const read = text.readWords;
  // Sentence reading credit and vocabulary totals use different counting rules.
  // Without a comparable, revision-aware reading total, show recorded activity
  // rather than claiming a completion percentage or a remaining reading time.
  return {
    percent: text.isFinished ? 100 : null,
    label: 'Reading logged',
    position: text.isFinished ? 'Completed · ready to revisit' : read != null && read > 0
      ? `${read.toLocaleString()} words read` : 'Ready to read',
    eta: null,
  };
};
