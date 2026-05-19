import { describe, test, expect } from 'vitest';
import { formatDate, truncateText, calculateReadingTime, formatTime } from '../utils/helpers';

describe('formatDate', () => {
  test('returns a non-empty localized string for an ISO date', () => {
    const out = formatDate('2026-05-19T00:00:00Z');
    expect(out).toBeTruthy();
    expect(typeof out).toBe('string');
    // The string contains the year regardless of locale.
    expect(out).toMatch(/2026/);
  });

  test('accepts a Date object', () => {
    expect(formatDate(new Date('2026-01-15'))).toMatch(/2026/);
  });

  test('accepts a numeric timestamp', () => {
    expect(formatDate(Date.UTC(2026, 0, 15))).toMatch(/2026/);
  });
});

describe('truncateText', () => {
  test('returns empty string for null, undefined, or empty input', () => {
    expect(truncateText(null)).toBe('');
    expect(truncateText(undefined)).toBe('');
    expect(truncateText('')).toBe('');
  });

  test('returns the input unchanged when within the default max length', () => {
    expect(truncateText('short string')).toBe('short string');
  });

  test('truncates and appends ellipsis when over the default length', () => {
    const long = 'a'.repeat(120);
    const out = truncateText(long);
    expect(out).toHaveLength(103);
    expect(out.endsWith('...')).toBe(true);
  });

  test('respects custom maxLength', () => {
    expect(truncateText('hello world', 5)).toBe('hello...');
  });

  test('returns the input unchanged when length equals maxLength', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });
});

describe('calculateReadingTime', () => {
  test('returns "< 1 min" for null/undefined/empty content', () => {
    expect(calculateReadingTime(null)).toBe('< 1 min');
    expect(calculateReadingTime(undefined)).toBe('< 1 min');
    expect(calculateReadingTime('')).toBe('< 1 min');
  });

  test('returns "1 min read" for short content (Math.max floor)', () => {
    expect(calculateReadingTime('one two three')).toBe('1 min read');
  });

  test('scales the estimate by 200 words per minute', () => {
    const fourHundredWords = Array(400).fill('word').join(' ');
    expect(calculateReadingTime(fourHundredWords)).toBe('2 min read');

    const sixHundredWords = Array(600).fill('word').join(' ');
    expect(calculateReadingTime(sixHundredWords)).toBe('3 min read');
  });

  test('ceils partial-minute counts up', () => {
    const twoHundredOneWords = Array(201).fill('word').join(' ');
    expect(calculateReadingTime(twoHundredOneWords)).toBe('2 min read');
  });
});

describe('formatTime', () => {
  test('returns "00:00" for NaN, negative, and undefined-cast values', () => {
    expect(formatTime(NaN)).toBe('00:00');
    expect(formatTime(-1)).toBe('00:00');
    expect(formatTime(-100.5)).toBe('00:00');
  });

  test('formats zero as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  test('formats sub-hour durations as MM:SS', () => {
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3599)).toBe('59:59');
  });

  test('formats hour-plus durations as HH:MM:SS', () => {
    expect(formatTime(3600)).toBe('01:00:00');
    expect(formatTime(3661)).toBe('01:01:01');
    expect(formatTime(36000)).toBe('10:00:00');
  });

  test('floors fractional seconds', () => {
    expect(formatTime(65.9)).toBe('01:05');
    expect(formatTime(3600.7)).toBe('01:00:00');
  });
});
