import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutoSave } from '../hooks/useAutoSave';

type Form = { theme: string; model: string; hasKey: boolean };

const initialValues: Form = { theme: 'dark', model: 'm1', hasKey: false };
const EDITABLE = ['theme', 'model'] as const;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const setup = (save = vi.fn(async (patch: Partial<Form>) => patch), onSaved = vi.fn()) => {
  const hook = renderHook(() =>
    useAutoSave<Form>({ initialValues, editableKeys: EDITABLE, save, onSaved, savedNoticeMs: 1000 })
  );
  return { ...hook, save, onSaved };
};

// Runs pending timers and lets the save promise chain settle.
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useAutoSave', () => {
  beforeEach(() => {
    // The project default lets the fake clock drift with wall time, which makes the
    // "not yet at 299 ms" checks flaky under load. Here time only moves when a test says so.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('saves only the changed field once the delay passes', async () => {
    const { result, save, onSaved } = setup();

    act(() => result.current.setField('theme', 'light', 300));
    expect(result.current.values.theme).toBe('light');
    expect(result.current.status).toBe('pending');

    await advance(299);
    expect(save).not.toHaveBeenCalled();

    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ theme: 'light' });
    expect(onSaved).toHaveBeenCalledWith({ theme: 'light' }, { theme: 'light' });
    expect(result.current.status).toBe('saved');
    expect(result.current.hasUnsavedChanges()).toBe(false);
  });

  test('goes back to idle once the saved notice has been shown', async () => {
    const { result } = setup();

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);
    expect(result.current.status).toBe('saved');

    await advance(1000);
    expect(result.current.status).toBe('idle');
  });

  test('coalesces a burst of typing into one save of the final value', async () => {
    const { result, save } = setup();

    act(() => result.current.setField('model', 'a', 800));
    await advance(500);
    act(() => result.current.setField('model', 'ab', 800));
    await advance(500);
    act(() => result.current.setField('model', 'abc', 800));
    await advance(800);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ model: 'abc' });
  });

  test('a change undone before its delay passes is never sent', async () => {
    const { result, save } = setup();

    act(() => result.current.setField('theme', 'light', 300));
    act(() => result.current.setField('theme', 'dark', 300));
    expect(result.current.status).toBe('idle');
    expect(result.current.hasUnsavedChanges()).toBe(false);

    await advance(1000);
    expect(save).not.toHaveBeenCalled();
  });

  test('display-only fields never trigger a save', async () => {
    const { result, save } = setup();

    act(() => result.current.setField('hasKey', true, 0));
    await advance(1000);

    expect(result.current.values.hasKey).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  test('runs one save at a time and sends a change made meanwhile right after', async () => {
    const first = deferred<unknown>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (patch: Partial<Form>) => patch);
    const { result } = setup(save);

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saving');

    act(() => result.current.setField('model', 'm2', 0));
    await advance(100);
    // Still waiting for the first response.
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ theme: 'light' });
    });
    await advance(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ model: 'm2' });
    expect(result.current.status).toBe('saved');
  });

  test('a field edited again during its own save is sent again with the newer value', async () => {
    const first = deferred<unknown>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (patch: Partial<Form>) => patch);
    const { result } = setup(save);

    act(() => result.current.setField('model', 'draft', 0));
    await advance(0);
    act(() => result.current.setField('model', 'final', 0));
    await advance(0);

    await act(async () => {
      first.resolve({ model: 'draft' });
    });
    await advance(0);

    expect(save.mock.calls.map(([patch]) => patch)).toEqual([{ model: 'draft' }, { model: 'final' }]);
    expect(result.current.hasUnsavedChanges()).toBe(false);
  });

  test('waits out the typing pause after a save instead of sending half-typed text', async () => {
    const first = deferred<unknown>();
    const save = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (patch: Partial<Form>) => patch);
    const { result } = setup(save);

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);
    act(() => result.current.setField('model', 'hal', 800));

    await act(async () => {
      first.resolve({ theme: 'light' });
    });
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('pending');

    act(() => result.current.setField('model', 'half-typed no more', 800));
    await advance(800);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ model: 'half-typed no more' });
  });

  test('a failed save reports the error, stays unsaved, and flush retries it', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('Network down'))
      .mockImplementation(async (patch: Partial<Form>) => patch);
    const { result, onSaved } = setup(save);

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network down');
    expect(result.current.hasUnsavedChanges()).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });

    expect(ok).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ theme: 'light' });
    expect(result.current.status).toBe('saved');
    expect(result.current.error).toBeNull();
  });

  test('flush resolves false while the save keeps failing', async () => {
    const save = vi.fn().mockRejectedValue(new Error('500'));
    const { result } = setup(save);

    act(() => result.current.setField('theme', 'light', 5000));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.flush();
    });

    expect(ok).toBe(false);
    expect(save).toHaveBeenCalledWith({ theme: 'light' });
  });

  test('changing a failed field back to the saved value clears the error', async () => {
    const save = vi.fn().mockRejectedValue(new Error('500'));
    const { result } = setup(save);

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);
    expect(result.current.status).toBe('error');

    act(() => result.current.setField('theme', 'dark', 0));
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.hasUnsavedChanges()).toBe(false);
  });

  test('a flush with nothing to save leaves the status alone', async () => {
    const { result, save } = setup();

    await act(async () => {
      await result.current.flush();
    });

    expect(save).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  test('a flush with nothing to save does not block later saves', async () => {
    // Regression: the empty run finishes synchronously, so it must not be left marked as running.
    const { result, save } = setup();

    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.hasUnsavedChanges()).toBe(false);

    act(() => result.current.setField('theme', 'light', 100));
    await advance(100);
    expect(save).toHaveBeenCalledWith({ theme: 'light' });

    act(() => result.current.setField('model', 'm2', 5000));
    await act(async () => {
      await result.current.flush();
    });
    expect(save).toHaveBeenLastCalledWith({ model: 'm2' });
  });

  test('a save that throws synchronously is reported, not left running', async () => {
    const save = vi.fn()
      .mockImplementationOnce(() => { throw new Error('boom'); })
      .mockImplementation(async (patch: Partial<Form>) => patch);
    const { result } = setup(save);

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('boom');

    act(() => result.current.setField('model', 'm2', 0));
    await advance(0);
    expect(save).toHaveBeenLastCalledWith({ theme: 'light', model: 'm2' });
    expect(result.current.status).toBe('saved');
  });

  test('retries a failed save when the browser comes back online', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementation(async (patch: Partial<Form>) => patch);
    const { result } = setup(save);

    act(() => result.current.setField('theme', 'light', 0));
    await advance(0);
    expect(result.current.status).toBe('error');

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await advance(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });

  test('reset and applyServerValues change values without saving them', async () => {
    const { result, save } = setup();

    act(() => result.current.reset({ theme: 'light', model: 'loaded', hasKey: true }));
    act(() => result.current.applyServerValues({ hasKey: false, model: 'from-server' }));
    await advance(1000);

    expect(result.current.values).toEqual({ theme: 'light', model: 'from-server', hasKey: false });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedChanges()).toBe(false);
  });

  test('asks before the tab closes while a change is unsaved, and starts saving it', async () => {
    const { result, save } = setup();

    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    act(() => result.current.setField('theme', 'light', 5000));
    const dirty = new Event('beforeunload', { cancelable: true });
    await act(async () => {
      window.dispatchEvent(dirty);
    });

    expect(dirty.defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledWith({ theme: 'light' });
  });

  test('saves a waiting change when the page is hidden', async () => {
    const { result, save } = setup();
    act(() => result.current.setField('model', 'typed', 5000));

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();

    expect(save).toHaveBeenCalledWith({ model: 'typed' });
  });

  test('saves a waiting change when the component unmounts', async () => {
    const { result, save, unmount } = setup();
    act(() => result.current.setField('model', 'typed', 5000));

    unmount();
    await advance(0);

    expect(save).toHaveBeenCalledWith({ model: 'typed' });
  });
});
