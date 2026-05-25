import React from 'react';
import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const setNavigatorOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

function Probe({ onReconnect, onStatus }) {
  const online = useOnlineStatus({ onReconnect });
  React.useEffect(() => { onStatus(online); }, [online, onStatus]);
  return null;
}

describe('useOnlineStatus', () => {
  test('returns true initially when navigator.onLine is true', () => {
    setNavigatorOnline(true);
    const onStatus = vi.fn();
    render(<Probe onStatus={onStatus} />);
    expect(onStatus).toHaveBeenLastCalledWith(true);
  });

  test('returns false initially when navigator.onLine is false', () => {
    setNavigatorOnline(false);
    const onStatus = vi.fn();
    render(<Probe onStatus={onStatus} />);
    expect(onStatus).toHaveBeenLastCalledWith(false);
  });

  test('updates to false on window "offline" event', () => {
    setNavigatorOnline(true);
    const onStatus = vi.fn();
    render(<Probe onStatus={onStatus} />);
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(onStatus).toHaveBeenLastCalledWith(false);
  });

  test('updates back to true on window "online" event', () => {
    setNavigatorOnline(false);
    const onStatus = vi.fn();
    render(<Probe onStatus={onStatus} />);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(onStatus).toHaveBeenLastCalledWith(true);
  });

  test('fires onReconnect on offline → online transition only', () => {
    setNavigatorOnline(true);
    const onReconnect = vi.fn();
    render(<Probe onReconnect={onReconnect} onStatus={() => {}} />);

    // Already online → another online event should not fire onReconnect
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(onReconnect).not.toHaveBeenCalled();

    // Go offline, then online → should fire
    act(() => { window.dispatchEvent(new Event('offline')); });
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  test('cleans up event listeners on unmount', () => {
    setNavigatorOnline(true);
    const onStatus = vi.fn();
    const { unmount } = render(<Probe onStatus={onStatus} />);
    unmount();
    onStatus.mockClear();
    act(() => { window.dispatchEvent(new Event('offline')); });
    // Listener should be gone; no further update fired.
    expect(onStatus).not.toHaveBeenCalled();
  });
});
