// --- SRT Parsing Utilities ---

export type SrtEntry = {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
};

export const parseSrtTime = (timeString: string | null | undefined): number => {
  if (!timeString) return 0;
  const parts = timeString.trim().split(':');
  const secondsParts = parts[2]?.split(/[,.]/);
  if (!secondsParts || secondsParts.length < 2) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = parseInt(secondsParts[1].padEnd(3, '0').slice(0, 3), 10);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) return 0;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

export const parseSrtContent = (srtContent: string | null | undefined): SrtEntry[] => {
  if (!srtContent) return [];
  const lines = srtContent.trim().split(/\r?\n/);
  const entries: SrtEntry[] = [];
  let currentEntry: SrtEntry | null = null;
  let textBuffer: string[] = [];
  let hasTiming = false;
  const timingPattern = /^(\d+:\d{2}:\d{2}[,.]\d+)\s*-->\s*(\d+:\d{2}:\d{2}[,.]\d+)(?:\s+.*)?$/;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (currentEntry === null) {
      if (/^\d+$/.test(trimmedLine)) {
        currentEntry = { id: parseInt(trimmedLine, 10), startTime: 0, endTime: 0, text: '' };
        textBuffer = [];
        hasTiming = false;
      }
    } else if (!hasTiming && timingPattern.test(trimmedLine)) {
      const timeParts = trimmedLine.match(timingPattern)!;
      currentEntry.startTime = parseSrtTime(timeParts[1]);
      currentEntry.endTime = parseSrtTime(timeParts[2]);
      hasTiming = true;
    } else if (trimmedLine === '') {
      if (hasTiming) {
        currentEntry.text = textBuffer.join('\n').trim();
        entries.push(currentEntry);
      }
      currentEntry = null;
      textBuffer = [];
      hasTiming = false;
    } else if (currentEntry) {
      textBuffer.push(trimmedLine);
    }
  }
  if (currentEntry && hasTiming) {
    currentEntry.text = textBuffer.length > 0 ? textBuffer.join('\n').trim() : '';
    entries.push(currentEntry);
  }
  return entries;
};

/**
 * Find the SRT line index matching a given time.
 * Uses inclusive end boundary (<=) to avoid dead zones at segment transitions.
 */
export const findSrtLineIndex = (srtLines: SrtEntry[], time: number): number => {
  return srtLines.findIndex((line) => time >= line.startTime && time <= line.endTime);
};
