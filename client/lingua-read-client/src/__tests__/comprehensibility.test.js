import '@testing-library/jest-dom';
import {
  bandLabel,
  bandVariant,
  comprehensionBand,
  comprehensionPercent,
  KRASHEN_SWEET_SPOT_MAX,
  KRASHEN_SWEET_SPOT_MIN,
} from '../utils/comprehensibility';

describe('comprehensionPercent', () => {
  test('derives percent from known words', () => {
    expect(comprehensionPercent({ totalWords: 100, knownWords: 87 })).toBe(87);
  });

  test('prefers knownWords over other inputs when present', () => {
    const pct = comprehensionPercent({
      totalWords: 100,
      knownWords: 50,
      unknownWords: 10,
      unknownWordPercentage: 99,
    });
    expect(pct).toBe(50);
  });

  test('derives percent from unknownWordPercentage when knownWords missing', () => {
    expect(
      comprehensionPercent({ totalWords: 100, unknownWordPercentage: 12.5 })
    ).toBeCloseTo(87.5, 5);
  });

  test('derives percent from unknownWords when only that field is present', () => {
    expect(
      comprehensionPercent({ totalWords: 200, unknownWords: 50 })
    ).toBe(75);
  });

  test('returns null when totalWords is zero', () => {
    expect(comprehensionPercent({ totalWords: 0, knownWords: 0 })).toBeNull();
  });

  test('returns null when totalWords is missing', () => {
    expect(comprehensionPercent({ knownWords: 5 })).toBeNull();
  });

  test('returns null when totalWords is negative (corrupt data)', () => {
    expect(comprehensionPercent({ totalWords: -10, knownWords: 5 })).toBeNull();
  });

  test('returns null when nothing computable is provided', () => {
    expect(comprehensionPercent({ totalWords: 100 })).toBeNull();
  });

  test('clamps values above 100 to 100', () => {
    expect(comprehensionPercent({ totalWords: 10, knownWords: 999 })).toBe(100);
  });

  test('clamps negative results to 0', () => {
    expect(
      comprehensionPercent({ totalWords: 100, unknownWordPercentage: 150 })
    ).toBe(0);
  });
});

describe('comprehensionBand', () => {
  test('returns unknown for null percent', () => {
    expect(comprehensionBand(null)).toBe('unknown');
  });

  test('returns too-hard below 70%', () => {
    expect(comprehensionBand(0)).toBe('too-hard');
    expect(comprehensionBand(50)).toBe('too-hard');
    expect(comprehensionBand(69.9)).toBe('too-hard');
  });

  test('returns challenging from 70% up to (but not including) the sweet-spot min', () => {
    expect(comprehensionBand(70)).toBe('challenging');
    expect(comprehensionBand(85)).toBe('challenging');
    expect(comprehensionBand(KRASHEN_SWEET_SPOT_MIN - 0.1)).toBe('challenging');
  });

  test('returns sweet-spot inside the Krashen i+1 band (inclusive)', () => {
    expect(comprehensionBand(KRASHEN_SWEET_SPOT_MIN)).toBe('sweet-spot');
    expect(comprehensionBand(95)).toBe('sweet-spot');
    expect(comprehensionBand(KRASHEN_SWEET_SPOT_MAX)).toBe('sweet-spot');
  });

  test('returns too-easy above the sweet-spot max', () => {
    expect(comprehensionBand(KRASHEN_SWEET_SPOT_MAX + 0.1)).toBe('too-easy');
    expect(comprehensionBand(99)).toBe('too-easy');
    expect(comprehensionBand(100)).toBe('too-easy');
  });
});

describe('bandVariant', () => {
  test('maps every band to a Bootstrap variant', () => {
    expect(bandVariant('too-hard')).toBe('danger');
    expect(bandVariant('challenging')).toBe('warning');
    expect(bandVariant('sweet-spot')).toBe('success');
    expect(bandVariant('too-easy')).toBe('secondary');
    expect(bandVariant('unknown')).toBe('light');
  });
});

describe('bandLabel', () => {
  test('provides a human label for every band', () => {
    expect(bandLabel('too-hard')).toBe('Too hard');
    expect(bandLabel('challenging')).toBe('Challenging');
    expect(bandLabel('sweet-spot')).toBe('Just right');
    expect(bandLabel('too-easy')).toBe('Too easy');
    expect(bandLabel('unknown')).toBe('Unknown');
  });
});
