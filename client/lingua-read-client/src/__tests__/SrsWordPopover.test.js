import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { screen, waitFor } from '@testing-library/react';
import SrsWordPopover from '../components/SrsWordPopover';
import '@testing-library/jest-dom';

vi.mock('react-bootstrap', async () => {
  const actual = await vi.importActual('react-bootstrap');
  return {
    ...actual,
    Overlay: ({ show, children }) => (show ? children : null)
  };
});

describe('SrsWordPopover', () => {
  const mockWord = {
    wordId: 1,
    term: 'gato',
    translation: 'cat',
    wordStatus: 4
  };

  const mockTargetRef = document.createElement('div'); // Dummy target element
  const mockOnGrade = vi.fn();
  const mockOnHide = vi.fn();
  let container;
  let root;

  const renderPopover = (props) => {
    act(() => {
      root.render(
        <SrsWordPopover
          word={mockWord}
          targetRef={mockTargetRef}
          show={true}
          onHide={mockOnHide}
          onGrade={mockOnGrade}
          disabled={false}
          {...props}
        />
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders correctly when show is true', async () => {
    renderPopover();

    // The component uses React-Bootstrap Overlay/Popover which usually portals to document.body
    await waitFor(() => {
      expect(screen.getByText('gato')).toBeInTheDocument();
    });

    // Check translation is rendered
    expect(screen.getByText('cat')).toBeInTheDocument();

    // Check status badge is rendered ('Advanced' for status 4)
    expect(screen.getByText('Advanced')).toBeInTheDocument();

    // Check grading buttons are rendered
    expect(screen.getByRole('button', { name: /Again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Good/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Easy/i })).toBeInTheDocument();
  });

  it('does not render when show is false', () => {
    renderPopover({ show: false });

    expect(screen.queryByText('gato')).not.toBeInTheDocument();
  });

  it('calls onGrade when a grade button is clicked', async () => {
    renderPopover();

    const goodButton = await screen.findByRole('button', { name: /Good/i });
    act(() => {
      goodButton.click();
    });

    expect(mockOnGrade).toHaveBeenCalledTimes(1);
    expect(mockOnGrade).toHaveBeenCalledWith(mockWord, 2); // Grade 2 is 'Good'
  });

  it('disables buttons when disabled prop is true', async () => {
    renderPopover({ disabled: true });

    const buttons = await screen.findAllByRole('button');
    buttons.forEach(btn => {
      expect(btn).toBeDisabled();
    });
  });
});
