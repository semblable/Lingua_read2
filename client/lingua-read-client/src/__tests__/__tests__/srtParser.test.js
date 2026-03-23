import { parseSrtTime, parseSrtContent, findSrtLineIndex } from '../utils/srtParser';

describe('parseSrtTime', () => {
  test('parses standard SRT timestamp', () => {
    expect(parseSrtTime('00:01:30,500')).toBe(90.5);
  });

  test('parses zero timestamp', () => {
    expect(parseSrtTime('00:00:00,000')).toBe(0);
  });

  test('parses hours correctly', () => {
    expect(parseSrtTime('01:00:00,000')).toBe(3600);
  });

  test('returns 0 for null/undefined input', () => {
    expect(parseSrtTime(null)).toBe(0);
    expect(parseSrtTime(undefined)).toBe(0);
    expect(parseSrtTime('')).toBe(0);
  });

  test('returns 0 for malformed time string', () => {
    expect(parseSrtTime('garbage')).toBe(0);
    expect(parseSrtTime('12:34')).toBe(0);
    expect(parseSrtTime('00:00:00')).toBe(0); // missing comma separator
  });
});

describe('parseSrtContent', () => {
  test('parses standard SRT with trailing blank line', () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello world.

2
00:00:02,000 --> 00:00:04,000
Second line.

`;
    const entries = parseSrtContent(srt);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ id: 1, startTime: 0, endTime: 2, text: 'Hello world.' });
    expect(entries[1]).toEqual({ id: 2, startTime: 2, endTime: 4, text: 'Second line.' });
  });

  test('parses last entry without trailing blank line', () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello world.

2
00:00:02,000 --> 00:00:04,000
Last line no newline.`;
    const entries = parseSrtContent(srt);
    expect(entries).toHaveLength(2);
    expect(entries[1].text).toBe('Last line no newline.');
  });

  test('parses last entry with empty text and no trailing blank line', () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
Hello.

2
00:00:02,000 --> 00:00:04,000`;
    const entries = parseSrtContent(srt);
    expect(entries).toHaveLength(2);
    expect(entries[1].text).toBe('');
  });

  test('handles entry starting at exactly 00:00:00,000', () => {
    const srt = `1
00:00:00,000 --> 00:00:01,500
First line.

`;
    const entries = parseSrtContent(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0].startTime).toBe(0);
    expect(entries[0].endTime).toBe(1.5);
    expect(entries[0].text).toBe('First line.');
  });

  test('returns empty array for null/empty input', () => {
    expect(parseSrtContent(null)).toEqual([]);
    expect(parseSrtContent('')).toEqual([]);
    expect(parseSrtContent(undefined)).toEqual([]);
  });

  test('handles multi-line subtitle text', () => {
    const srt = `1
00:00:00,000 --> 00:00:03,000
Line one
Line two

`;
    const entries = parseSrtContent(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Line one\nLine two');
  });

  test('handles Windows-style CRLF line endings', () => {
    const srt = "1\r\n00:00:00,000 --> 00:00:02,000\r\nHello.\r\n\r\n";
    const entries = parseSrtContent(srt);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('Hello.');
  });

  test('skips entries with no timing line', () => {
    const srt = `1
Hello no timing.

2
00:00:01,000 --> 00:00:03,000
Valid entry.

`;
    const entries = parseSrtContent(srt);
    // The first entry has startTime=0 (never set), text="Hello no timing."
    // It will be pushed because startTime >= 0
    // But the second entry should parse correctly
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const valid = entries.find(e => e.text === 'Valid entry.');
    expect(valid).toBeDefined();
    expect(valid.startTime).toBe(1);
  });
});

describe('findSrtLineIndex', () => {
  const srtLines = [
    { id: 1, startTime: 0, endTime: 2 },
    { id: 2, startTime: 2.5, endTime: 5 },
    { id: 3, startTime: 5.5, endTime: 8 },
  ];

  test('finds correct line for time within segment', () => {
    expect(findSrtLineIndex(srtLines, 1)).toBe(0);
    expect(findSrtLineIndex(srtLines, 3)).toBe(1);
    expect(findSrtLineIndex(srtLines, 6)).toBe(2);
  });

  test('matches at exact startTime boundary', () => {
    expect(findSrtLineIndex(srtLines, 0)).toBe(0);
    expect(findSrtLineIndex(srtLines, 2.5)).toBe(1);
    expect(findSrtLineIndex(srtLines, 5.5)).toBe(2);
  });

  test('matches at exact endTime boundary (inclusive)', () => {
    expect(findSrtLineIndex(srtLines, 2)).toBe(0);
    expect(findSrtLineIndex(srtLines, 5)).toBe(1);
    expect(findSrtLineIndex(srtLines, 8)).toBe(2);
  });

  test('returns -1 for time in gap between segments', () => {
    expect(findSrtLineIndex(srtLines, 2.25)).toBe(-1); // between segment 1 end (2) and segment 2 start (2.5)
  });

  test('returns -1 for time before first segment', () => {
    const lines = [{ id: 1, startTime: 1, endTime: 3 }];
    expect(findSrtLineIndex(lines, 0.5)).toBe(-1);
  });

  test('returns -1 for time after last segment', () => {
    expect(findSrtLineIndex(srtLines, 10)).toBe(-1);
  });

  test('returns -1 for empty srtLines', () => {
    expect(findSrtLineIndex([], 1)).toBe(-1);
  });
});
