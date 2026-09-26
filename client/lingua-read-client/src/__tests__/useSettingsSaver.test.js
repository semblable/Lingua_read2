import { renderHook, act } from '@testing-library/react';
import { useSettingsSaver, SETTINGS_SAVE_DELAY_MS } from '../hooks/useSettingsSaver';
import { updateUserSettings } from '../utils/api';

vi.mock('../utils/api', () => ({
  updateUserSettings: vi.fn()
}));

// A deferred promise per request, so a test decides when each save finishes.
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('useSettingsSaver', () => {
  beforeEach(() => {
    // Pinned clock: the suite-wide fake timers advance with wall time.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: false });
    updateUserSettings.mockReset();
    updateUserSettings.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('applies each change at once and sends a run of changes as one patch', async () => {
    const updateSetting = vi.fn();
    const { result } = renderHook(() => useSettingsSaver(updateSetting));

    act(() => {
      result.current({ textSize: 18 });
      result.current({ textSize: 20 });
      result.current({ leftPanelWidth: 80 });
    });

    expect(updateSetting).toHaveBeenCalledWith('textSize', 18);
    expect(updateSetting).toHaveBeenCalledWith('textSize', 20);
    expect(updateSetting).toHaveBeenCalledWith('leftPanelWidth', 80);
    expect(updateUserSettings).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(SETTINGS_SAVE_DELAY_MS); });

    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({ textSize: 20, leftPanelWidth: 80 });
  });

  test('sends one request at a time, the newest value last', async () => {
    const first = deferred();
    updateUserSettings.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useSettingsSaver(vi.fn()));

    act(() => { result.current({ leftPanelWidth: 80 }); });
    await act(async () => { vi.advanceTimersByTime(SETTINGS_SAVE_DELAY_MS); });
    expect(updateUserSettings).toHaveBeenCalledTimes(1);

    // A change while the first request is out waits for it.
    act(() => { result.current({ leftPanelWidth: 75 }); });
    await act(async () => { vi.advanceTimersByTime(SETTINGS_SAVE_DELAY_MS); });
    expect(updateUserSettings).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve({}); });

    expect(updateUserSettings).toHaveBeenCalledTimes(2);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ leftPanelWidth: 75 });
  });

  test('keeps a failed patch and sends it with the next change', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    updateUserSettings.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useSettingsSaver(vi.fn()));

    act(() => { result.current({ paragraphSpacing: 1.6 }); });
    await act(async () => { vi.advanceTimersByTime(SETTINGS_SAVE_DELAY_MS); });
    expect(updateUserSettings).toHaveBeenCalledTimes(1);

    act(() => { result.current({ textSize: 20 }); });
    await act(async () => { vi.advanceTimersByTime(SETTINGS_SAVE_DELAY_MS); });

    expect(updateUserSettings).toHaveBeenCalledTimes(2);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ paragraphSpacing: 1.6, textSize: 20 });
    consoleError.mockRestore();
  });

  test('sends a waiting change when the component unmounts', async () => {
    const { result, unmount } = renderHook(() => useSettingsSaver(vi.fn()));

    act(() => { result.current({ readingDensity: 'compact' }); });
    expect(updateUserSettings).not.toHaveBeenCalled();

    await act(async () => { unmount(); });

    expect(updateUserSettings).toHaveBeenCalledWith({ readingDensity: 'compact' });
  });
});
