import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

test('contains a render failure, preserves the shell and supports retry and reload', () => {
  let fail = true;
  const BrokenView = () => {
    if (fail) throw new Error('Private technical details');
    return <p>Recovered content</p>;
  };
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
  try {
    render(<><nav>Navigation</nav><ErrorBoundary><BrokenView /></ErrorBoundary></>);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Private technical details')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return home' })).toHaveAttribute('href', '/');
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered content')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally {
    errorLog.mockRestore();
    reload.mockRestore();
  }
});

test('changing the route key resets a failed boundary', () => {
  const BrokenView = () => { throw new Error('bad route'); };
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const view = render(<ErrorBoundary key="/broken"><BrokenView /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    view.rerender(<ErrorBoundary key="/library"><p>Library</p></ErrorBoundary>);
    expect(screen.getByText('Library')).toBeInTheDocument();
  } finally {
    errorLog.mockRestore();
  }
});
