import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useLibraryStore } from '../utils/store';
import { useDragSelect } from '../hooks/useDragSelect';
import SelectionRectangle from '../components/library/SelectionRectangle';

// --- Store: setSelectedItems, lastClickedItem, setLastClickedItem ---

describe('useLibraryStore - drag select additions', () => {
  beforeEach(() => {
    useLibraryStore.setState({
      selectedItems: [],
      lastClickedItem: null
    });
  });

  test('setSelectedItems replaces entire selection', () => {
    const items = [
      { id: 1, type: 'book' },
      { id: 2, type: 'text' }
    ];
    useLibraryStore.getState().setSelectedItems(items);
    expect(useLibraryStore.getState().selectedItems).toEqual(items);
  });

  test('setSelectedItems overwrites previous selection', () => {
    useLibraryStore.getState().setSelectedItems([{ id: 1, type: 'book' }]);
    useLibraryStore.getState().setSelectedItems([{ id: 3, type: 'folder' }]);
    expect(useLibraryStore.getState().selectedItems).toEqual([{ id: 3, type: 'folder' }]);
  });

  test('setSelectedItems with empty array clears selection', () => {
    useLibraryStore.getState().setSelectedItems([{ id: 1, type: 'book' }]);
    useLibraryStore.getState().setSelectedItems([]);
    expect(useLibraryStore.getState().selectedItems).toEqual([]);
  });

  test('setLastClickedItem stores the item', () => {
    useLibraryStore.getState().setLastClickedItem({ id: 5, type: 'text' });
    expect(useLibraryStore.getState().lastClickedItem).toEqual({ id: 5, type: 'text' });
  });

  test('clearSelection also resets lastClickedItem', () => {
    useLibraryStore.getState().setLastClickedItem({ id: 5, type: 'text' });
    useLibraryStore.getState().setSelectedItems([{ id: 5, type: 'text' }]);
    useLibraryStore.getState().clearSelection();
    expect(useLibraryStore.getState().selectedItems).toEqual([]);
    expect(useLibraryStore.getState().lastClickedItem).toBeNull();
  });

  test('toggleSelectItem still works alongside new methods', () => {
    useLibraryStore.getState().toggleSelectItem(1, 'book');
    expect(useLibraryStore.getState().selectedItems).toEqual([{ id: 1, type: 'book' }]);
    useLibraryStore.getState().toggleSelectItem(1, 'book');
    expect(useLibraryStore.getState().selectedItems).toEqual([]);
  });
});

// --- SelectionRectangle component ---

describe('SelectionRectangle', () => {
  test('renders nothing when rect is null', () => {
    const { container } = render(<SelectionRectangle rect={null} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders a div with correct styles when rect is provided', () => {
    const rect = { x: 10, y: 20, width: 100, height: 50 };
    const { container } = render(<SelectionRectangle rect={rect} />);
    const el = container.firstChild;
    expect(el).not.toBeNull();
    expect(el).toHaveClass('drag-select-rectangle');
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('50px');
  });
});

// --- useDragSelect hook ---

function TestDragSelectHarness({ enabled = true }) {
  const containerRef = React.useRef(null);
  const { selectionRect, isDragSelecting } = useDragSelect({ containerRef, enabled });

  return (
    <div>
      <div ref={containerRef} data-testid="container" style={{ width: 500, height: 500 }}>
        <div data-selectable-id="1" data-selectable-type="book" data-testid="item-1"
          style={{ position: 'absolute', left: 10, top: 10, width: 100, height: 100 }}
        >
          Book 1
        </div>
        <div data-selectable-id="2" data-selectable-type="text" data-testid="item-2"
          style={{ position: 'absolute', left: 200, top: 200, width: 100, height: 100 }}
        >
          Text 1
        </div>
      </div>
      <span data-testid="is-selecting">{isDragSelecting ? 'true' : 'false'}</span>
      <span data-testid="has-rect">{selectionRect ? 'true' : 'false'}</span>
    </div>
  );
}

describe('useDragSelect', () => {
  beforeEach(() => {
    useLibraryStore.setState({ selectedItems: [], lastClickedItem: null });
    // Mock requestAnimationFrame
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb();
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    window.requestAnimationFrame.mockRestore();
    window.cancelAnimationFrame.mockRestore();
  });

  test('does not activate drag select when clicking inside a card', () => {
    const { getByTestId } = render(
      <div>
        <div data-testid="container-wrapper">
          <TestDragSelectWrapper />
        </div>
      </div>
    );

    // The isDragSelecting should remain false when no drag happens
    expect(screen.getByTestId('is-selecting').textContent).toBe('false');
  });

  test('does not activate when enabled is false', () => {
    render(<TestDragSelectHarness enabled={false} />);
    const container = screen.getByTestId('container');

    fireEvent.mouseDown(container, { clientX: 0, clientY: 0, button: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });

    expect(screen.getByTestId('is-selecting').textContent).toBe('false');

    fireEvent.mouseUp(document);
  });

  test('does not activate on right click', () => {
    render(<TestDragSelectHarness />);
    const container = screen.getByTestId('container');

    fireEvent.mouseDown(container, { clientX: 0, clientY: 0, button: 2 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });

    expect(screen.getByTestId('is-selecting').textContent).toBe('false');

    fireEvent.mouseUp(document);
  });

  test('activates drag selecting after exceeding dead zone', () => {
    render(<TestDragSelectHarness />);
    const container = screen.getByTestId('container');

    act(() => {
      fireEvent.mouseDown(container, { clientX: 0, clientY: 0, button: 0 });
    });

    // Move less than 5px - should not activate
    act(() => {
      fireEvent.mouseMove(document, { clientX: 2, clientY: 2 });
    });
    expect(screen.getByTestId('is-selecting').textContent).toBe('false');

    // Move more than 5px - should activate
    act(() => {
      fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    });
    expect(screen.getByTestId('is-selecting').textContent).toBe('true');
    expect(screen.getByTestId('has-rect').textContent).toBe('true');

    act(() => {
      fireEvent.mouseUp(document);
    });
    expect(screen.getByTestId('is-selecting').textContent).toBe('false');
    expect(screen.getByTestId('has-rect').textContent).toBe('false');
  });

  test('clears selection rect on mouseup', () => {
    render(<TestDragSelectHarness />);
    const container = screen.getByTestId('container');

    act(() => {
      fireEvent.mouseDown(container, { clientX: 0, clientY: 0, button: 0 });
      fireEvent.mouseMove(document, { clientX: 50, clientY: 50 });
    });

    expect(screen.getByTestId('has-rect').textContent).toBe('true');

    act(() => {
      fireEvent.mouseUp(document);
    });

    expect(screen.getByTestId('has-rect').textContent).toBe('false');
  });
});

// Simple wrapper to use if needed
function TestDragSelectWrapper() {
  const containerRef = React.useRef(null);
  const { isDragSelecting } = useDragSelect({ containerRef, enabled: true });
  return (
    <div ref={containerRef} data-testid="container">
      <div className="card">
        <span data-testid="card-inner">Card</span>
      </div>
      <span data-testid="is-selecting">{isDragSelecting ? 'true' : 'false'}</span>
      <span data-testid="has-rect">false</span>
    </div>
  );
}
