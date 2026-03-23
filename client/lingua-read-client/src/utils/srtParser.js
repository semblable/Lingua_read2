// --- SRT Parsing Utilities ---

export const parseSrtTime = (timeString) => {
  if (!timeString) return 0;
  const parts = timeString.split(':');
  const secondsParts = parts[2]?.split(',');
  if (!secondsParts || secondsParts.length < 2) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = parseInt(secondsParts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) return 0;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

export const parseSrtContent = (srtContent) => {
  if (!srtContent) return [];
  const lines = srtContent.trim().split(/\r?\n/);
  const entries = [];
  let currentEntry = null;
  let textBuffer = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (currentEntry === null) {
      if (/^\d+$/.test(trimmedLine)) {
        currentEntry = { id: parseInt(trimmedLine, 10), startTime: 0, endTime: 0, text: '' };
        textBuffer = [];
      }
    } else if (currentEntry.startTime === 0 && trimmedLine.includes('-->')) {
      const timeParts = trimmedLine.split(' --> ');
      if (timeParts.length === 2) {
        currentEntry.startTime = parseSrtTime(timeParts[0]);
        currentEntry.endTime = parseSrtTime(timeParts[1]);
      }
    } else if (trimmedLine === '') {
      if (currentEntry && currentEntry.startTime >= 0 && textBuffer.length > 0) {
        currentEntry.text = textBuffer.join('\n').trim();
        entries.push(currentEntry);
        currentEntry = null;
        textBuffer = [];
      } else if (currentEntry && currentEntry.startTime >= 0) {
        currentEntry.text = '';
        entries.push(currentEntry);
        currentEntry = null;
        textBuffer = [];
      }
    } else if (currentEntry) {
      textBuffer.push(trimmedLine);
    }
  }
  if (currentEntry && currentEntry.startTime >= 0) {
    currentEntry.text = textBuffer.length > 0 ? textBuffer.join('\n').trim() : '';
    entries.push(currentEntry);
  }
  return entries;
};

/**
 * Find the SRT line index matching a given time.
 * Uses inclusive end boundary (<=) to avoid dead zones at segment transitions.
 */
export const findSrtLineIndex = (srtLines, time) => {
  return srtLines.findIndex(line => time >= line.startTime && time <= line.endTime);
};
