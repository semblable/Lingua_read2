import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import storage from '../utils/storage';

describe('storage wrapper', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('getItem returns the stored value when localStorage works', () => {
    localStorage.setItem('foo', 'bar');
    expect(storage.getItem('foo')).toBe('bar');
  });

  test('getItem returns null for missing keys', () => {
    expect(storage.getItem('missing')).toBeNull();
  });

  test('getItem returns null and logs when localStorage.getItem throws', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(storage.getItem('foo')).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('setItem returns true on success', () => {
    expect(storage.setItem('foo', 'bar')).toBe(true);
    expect(localStorage.getItem('foo')).toBe('bar');
  });

  test('setItem returns false and logs when localStorage.setItem throws', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(storage.setItem('foo', 'bar')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('removeItem returns true on success and removes the value', () => {
    localStorage.setItem('foo', 'bar');
    expect(storage.removeItem('foo')).toBe(true);
    expect(localStorage.getItem('foo')).toBeNull();
  });

  test('removeItem returns false and logs when localStorage.removeItem throws', () => {
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(storage.removeItem('foo')).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test('clear returns true on success and clears all items', () => {
    localStorage.setItem('a', '1');
    localStorage.setItem('b', '2');
    expect(storage.clear()).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  test('clear returns false and logs when localStorage.clear throws', () => {
    vi.spyOn(window.localStorage, 'clear').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(storage.clear()).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
