import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useReaderInteraction } from '../hooks/useReaderInteraction';
import type { UseReaderInteractionOptions } from '../hooks/useReaderInteraction';
import { createReaderOccurrence } from '../utils/readerInteraction';

const units = (generation = 'one') => [0, 6, 11].map((start, index) => createReaderOccurrence({
  generation, blockId: 'sentence', processedText: 'Alpha Beta Alpha', start, end: start + (index === 1 ? 4 : 5),
  term: index === 1 ? 'Beta' : 'Alpha', sentence: 'Alpha Beta Alpha', entityKey: index === 1 ? 'word:2' : 'word:1',
}));
const occurrences = units();
function Harness({ hiddenIds = [], ...props }: Partial<UseReaderInteractionOptions> & {
  onStatusIntent: UseReaderInteractionOptions['onStatusIntent']; hiddenIds?: string[];
}) {
  const reader = useReaderInteraction({ generation: 'one', occurrences, ...props });
  return <>
    <button onClick={() => reader.enter()}>Interact</button>
    <button onClick={() => reader.move(1, false)}>Next word</button>
    <button onClick={() => reader.setStatus(3)}>Familiar</button>
    <button onClick={() => reader.openLookup()}>Lookup</button>
    <div {...reader.passageProps} data-testid="passage">
      {reader.state.occurrences.map((unit, index) => hiddenIds.includes(unit.id) ? null :
        <span key={unit.id} {...reader.getOccurrenceProps(unit)} data-testid={`word-${index}`}>{unit.term}</span>)}
    </div>
    <button>After passage</button>
    <input aria-label="Native input" />
    <output data-testid="mode">{reader.state.mode}</output>
    <output data-testid="target">{reader.shortcutTarget?.term ?? 'none'}</output>
    {reader.isLookupOpen && <div role="dialog" aria-modal="true" aria-label="Word lookup">
      <button autoFocus onClick={reader.closeLookup}>Close lookup</button>
      <input aria-label="Lookup notes" />
    </div>}
  </>;
}
afterEach(cleanup);
const enter = () => act(() => screen.getByTestId('passage').focus());

describe('reader interaction adapter', () => {
  test('both entry routes focus the same unit and expose exactly one passage tab stop', () => {
    render(<Harness onStatusIntent={vi.fn()} />);
    enter();
    expect(screen.getByTestId('word-0')).toHaveFocus();
    expect(screen.getByTestId('passage')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('passage').querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'Escape' });
    expect(screen.getByTestId('passage')).toHaveFocus();
    expect(screen.getByTestId('mode')).toHaveTextContent('reading');
    fireEvent.click(screen.getByText('Interact'));
    expect(screen.getByTestId('word-0')).toHaveFocus();
  });

  test('resting pointer never steals the keyboard target after rerender; movement changes shortcuts without focus', () => {
    const save = vi.fn();
    const view = render(<Harness onStatusIntent={save} />);
    fireEvent.pointerMove(screen.getByTestId('word-0'), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(screen.getByTestId('word-0'), { clientX: 12, clientY: 10 });
    enter();
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'ArrowRight' });
    expect(screen.getByTestId('word-1')).toHaveFocus();
    view.rerender(<Harness onStatusIntent={save} />);
    fireEvent.pointerEnter(screen.getByTestId('word-0'));
    fireEvent.pointerMove(screen.getByTestId('word-0'), { clientX: 12, clientY: 10 });
    fireEvent.keyDown(screen.getByTestId('word-1'), { key: '3' });
    expect(save.mock.calls[0][0]).toMatchObject({ term: 'Beta', status: 3 });
    fireEvent.pointerMove(screen.getByTestId('word-0'), { clientX: 13, clientY: 10 });
    expect(screen.getByTestId('word-1')).toHaveFocus();
    expect(screen.getByTestId('word-1')).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(screen.getByTestId('word-1'), { key: '4' });
    expect(save.mock.calls[1][0]).toMatchObject({ term: 'Alpha', status: 4 });
  });

  test('rapid status, navigation, status captures separate intentions and suppresses held status keys', () => {
    const save = vi.fn();
    render(<Harness onStatusIntent={save} />);
    enter();
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3' });
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'ArrowRight', repeat: true });
    fireEvent.keyDown(screen.getByTestId('word-1'), { key: '4' });
    fireEvent.keyDown(screen.getByTestId('word-1'), { key: '4', repeat: true });
    expect(save.mock.calls.map(([intent]) => [intent.term, intent.status])).toEqual([['Alpha', 3], ['Beta', 4]]);
  });

  test('native inputs, IME, modifiers, modal ownership and native selection keep their keys', () => {
    const save = vi.fn();
    const view = render(<Harness onStatusIntent={save} />);
    enter();
    fireEvent.keyDown(screen.getByLabelText('Native input'), { key: '3' });
    fireEvent.keyDown(screen.getByText('Familiar'), { key: '3' });
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3', isComposing: true });
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3', ctrlKey: true });
    const externalDialog = document.createElement('div');
    externalDialog.setAttribute('role', 'dialog');
    externalDialog.setAttribute('aria-modal', 'true');
    document.body.append(externalDialog);
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3' });
    externalDialog.remove();
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(screen.getByTestId('word-0'));
    selection.addRange(range);
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3' });
    selection.removeAllRanges();
    view.rerender(<Harness onStatusIntent={save} modalOwned />);
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3' });
    expect(save).not.toHaveBeenCalled();
  });

  test('character shortcut preference leaves native status/navigation available', () => {
    const save = vi.fn();
    render(<Harness onStatusIntent={save} characterShortcutsEnabled={false} />);
    enter();
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: '3' });
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'ArrowRight' });
    expect(screen.getByTestId('word-1')).toHaveFocus();
    fireEvent.click(screen.getByText('Familiar'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ term: 'Beta', status: 3 }));
  });

  test('lookup returns focus to the exact third occurrence and does not reopen on native Enter', async () => {
    render(<Harness onStatusIntent={vi.fn()} />);
    enter();
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('word-1'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('word-2'), { key: 'Enter' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close lookup'));
    await waitFor(() => expect(screen.getByTestId('word-2')).toHaveFocus());
    expect(screen.getByTestId('mode')).toHaveTextContent('interacting');
    fireEvent.keyDown(screen.getByText('Familiar'), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('Tab is not prevented and leaving the passage never redirects focus back', () => {
    render(<Harness onStatusIntent={vi.fn()} />);
    enter();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => screen.getByTestId('word-0').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    act(() => screen.getByText('After passage').focus());
    expect(screen.getByText('After passage')).toHaveFocus();
    expect(screen.getByTestId('mode')).toHaveTextContent('reading');
  });

  test('retokenization safely exits instead of reusing an old repeated-term anchor', () => {
    const save = vi.fn();
    const view = render(<Harness onStatusIntent={save} />);
    enter();
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'ArrowRight' });
    view.rerender(<Harness onStatusIntent={save} generation="two" occurrences={units('two')} />);
    expect(screen.getByTestId('passage')).toHaveFocus();
    expect(screen.getByTestId('mode')).toHaveTextContent('reading');
    fireEvent.keyDown(screen.getByTestId('passage'), { key: '3' });
    expect(save).not.toHaveBeenCalled();
  });

  test('a late virtual-row mount cannot restore focus into an obsolete generation', async () => {
    let finishMount!: () => void;
    let mountingSignal: AbortSignal | undefined;
    const pendingMount = new Promise<void>(resolve => { finishMount = resolve; });
    const mount = vi.fn((_occurrence, signal: AbortSignal) => { mountingSignal = signal; return pendingMount; });
    const save = vi.fn();
    const view = render(<Harness onStatusIntent={save} ensureOccurrenceMounted={mount} />);
    enter();
    fireEvent.keyDown(screen.getByTestId('word-0'), { key: 'Enter' });
    view.rerender(<Harness onStatusIntent={save} hiddenIds={[occurrences[0].id]} ensureOccurrenceMounted={mount} />);
    fireEvent.click(screen.getByText('Close lookup'));
    expect(mount).toHaveBeenCalledWith(occurrences[0], expect.any(AbortSignal));
    expect(screen.getByTestId('mode')).toHaveTextContent('lookup');
    view.rerender(<Harness onStatusIntent={save} generation="replacement" occurrences={units('replacement')} ensureOccurrenceMounted={mount} />);
    expect(mountingSignal?.aborted).toBe(true);
    await act(async () => { finishMount(); await pendingMount; });
    expect(screen.getByTestId('passage')).toHaveFocus();
    expect(screen.getByTestId('mode')).toHaveTextContent('reading');
  });

  test('fresh equivalent registry descriptors on each render do not create an effect update loop', () => {
    function FreshRegistry() {
      const reader = useReaderInteraction({ generation: 'one', occurrences: units(), onStatusIntent: vi.fn() });
      return <div {...reader.passageProps} data-testid="fresh-registry">{reader.state.mode}</div>;
    }
    render(<FreshRegistry />);
    expect(screen.getByTestId('fresh-registry')).toHaveTextContent('reading');
  });
});
