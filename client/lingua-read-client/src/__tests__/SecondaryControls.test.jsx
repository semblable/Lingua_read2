import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import SecondaryControls from '../components/reader/SecondaryControls';
import { getInitialSettings } from '../contexts/SettingsContext';

const propsFor = (overrides = {}) => ({
  isMobile: false, globalSettings: getInitialSettings(),
  setReadingDensity: vi.fn(), setReaderContentWidth: vi.fn(), setShowWordInfoPanel: vi.fn(),
  setReaderParagraphIndent: vi.fn(), setReaderTextAlignment: vi.fn(), setTextSize: vi.fn(),
  setLeftPanelWidth: vi.fn(), handleLineSpacingChange: vi.fn(), handleParagraphSpacingChange: vi.fn(),
  text: {}, loading: false, handleFullTextTranslation: vi.fn(), handleOpenSummaryPopup: vi.fn(),
  isSummarizing: false, handleTranslateUnknownWords: vi.fn(), translatingUnknown: false,
  handleMarkAllUnknownAsKnown: vi.fn(), isMarkingAll: false, wordsReady: true,
  ...overrides,
});

describe('reader utility controls', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  test('keeps layout preferences out of the toolbar and exposes them through Aa', async () => {
    const props = propsFor();
    render(<SecondaryControls {...props} />);
    expect(screen.queryByRole('button', { name: 'Increase text size' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All Known' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    const appearance = await screen.findByRole('dialog', { name: 'Reader appearance' });
    fireEvent.click(within(appearance).getByRole('button', { name: 'Increase text size' }));
    expect(props.setTextSize).toHaveBeenCalledWith(18);
    fireEvent.click(within(appearance).getByRole('button', { name: 'Narrow' }));
    expect(props.setReaderContentWidth).toHaveBeenCalledWith(620);
    fireEvent.click(within(appearance).getByRole('button', { name: 'Set relaxed paragraph spacing' }));
    expect(props.handleParagraphSpacingChange).toHaveBeenCalledWith(1.6);
    fireEvent.click(within(appearance).getByRole('button', { name: 'Set line spacing to 1.75' }));
    expect(props.handleLineSpacingChange).toHaveBeenCalledWith(1.75);
    expect(screen.getByRole('dialog', { name: 'Reader appearance' })).toBeVisible();
    fireEvent.keyDown(appearance, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reader appearance' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveFocus();
  });

  test('font value follows changes while advanced density and panel width remain distinct', async () => {
    const props = propsFor();
    function Harness() {
      const [settings, setSettings] = useState(props.globalSettings);
      return <SecondaryControls {...props} globalSettings={settings}
        setTextSize={textSize => setSettings(current => ({ ...current, textSize }))} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    const appearance = await screen.findByRole('dialog', { name: 'Reader appearance' });
    fireEvent.click(within(appearance).getByRole('button', { name: 'Increase text size' }));
    expect(within(appearance).getByLabelText('Current font size')).toHaveTextContent('18px');
    fireEvent.click(within(appearance).getByText('Advanced layout'));
    fireEvent.click(within(appearance).getByRole('button', { name: 'Compact' }));
    expect(props.setReadingDensity).toHaveBeenCalledWith('compact');
    fireEvent.click(within(appearance).getByRole('button', { name: 'Decrease reading area' }));
    expect(props.setLeftPanelWidth).toHaveBeenCalledWith(80);
  });

  test('bulk marking requires opening the separate lesson menu and waits for vocabulary', async () => {
    const props = propsFor({ wordsReady: false });
    const view = render(<SecondaryControls {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'More lesson actions' }));
    const allKnown = await screen.findByRole('button', { name: 'All Known' });
    expect(allKnown).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(allKnown);
    expect(props.handleMarkAllUnknownAsKnown).not.toHaveBeenCalled();
    view.rerender(<SecondaryControls {...props} wordsReady />);
    fireEvent.click(screen.getByRole('button', { name: 'All Known' }));
    expect(props.handleMarkAllUnknownAsKnown).toHaveBeenCalledTimes(1);
  });

  test('transcript preferences appear inside Aa and persist independently of text alignment', async () => {
    const props = propsFor({ isAudioTranscript: true });
    render(<SecondaryControls {...props} />);
    expect(screen.queryByRole('switch', { name: 'Flowing text' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    const appearance = await screen.findByRole('dialog', { name: 'Reader appearance' });
    expect(within(appearance).getByRole('button', { name: 'Center' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(appearance).getByRole('switch', { name: 'Flowing text' }));
    fireEvent.click(within(appearance).getByRole('button', { name: 'Justify' }));
    expect(localStorage.getItem('linguaReadAudioTranscriptLayout')).toBe('flow');
    expect(JSON.parse(localStorage.getItem('linguaReadAudioTranscriptAlignment'))).toEqual({ cues: 'center', flow: 'justify' });
    expect(props.setReaderTextAlignment).not.toHaveBeenCalled();
  });
});
