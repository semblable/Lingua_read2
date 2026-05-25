import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import ComprehensibilityBadge from '../components/shared/ComprehensibilityBadge';

describe('ComprehensibilityBadge', () => {
  test('renders nothing when totalWords is zero', () => {
    const { container } = render(
      <ComprehensibilityBadge totalWords={0} knownWords={0} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when totalWords is missing', () => {
    const { container } = render(<ComprehensibilityBadge knownWords={10} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing when no computable input is provided', () => {
    const { container } = render(<ComprehensibilityBadge totalWords={100} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders sweet-spot badge at 95% known', () => {
    render(<ComprehensibilityBadge totalWords={100} knownWords={95} />);
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveTextContent('95.0% known');
    expect(badge).toHaveAttribute('data-band', 'sweet-spot');
    expect(badge).toHaveClass('bg-success');
  });

  test('renders too-hard badge at 50% known', () => {
    render(<ComprehensibilityBadge totalWords={100} knownWords={50} />);
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveTextContent('50.0% known');
    expect(badge).toHaveAttribute('data-band', 'too-hard');
    expect(badge).toHaveClass('bg-danger');
  });

  test('renders challenging badge at 85% known', () => {
    render(<ComprehensibilityBadge totalWords={100} knownWords={85} />);
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveAttribute('data-band', 'challenging');
    expect(badge).toHaveClass('bg-warning');
  });

  test('renders too-easy badge at 99% known with integer formatting', () => {
    render(<ComprehensibilityBadge totalWords={100} knownWords={99} />);
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveTextContent('99% known');
    expect(badge).toHaveAttribute('data-band', 'too-easy');
    expect(badge).toHaveClass('bg-secondary');
  });

  test('derives from unknownWordPercentage', () => {
    render(
      <ComprehensibilityBadge totalWords={200} unknownWordPercentage={12.5} />
    );
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveTextContent('87.5% known');
    expect(badge).toHaveAttribute('data-band', 'challenging');
  });

  test('includes the band label in the tooltip', () => {
    render(<ComprehensibilityBadge totalWords={100} knownWords={95} />);
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveAttribute('title', expect.stringContaining('Just right'));
    expect(badge).toHaveAttribute('title', expect.stringContaining('100 word tokens'));
  });

  test('shows label inline when showLabel is set', () => {
    render(
      <ComprehensibilityBadge totalWords={100} knownWords={95} showLabel />
    );
    const badge = screen.getByTestId('comprehensibility-badge');
    expect(badge).toHaveTextContent('95.0% known · Just right');
  });

  test('honors className prop', () => {
    render(
      <ComprehensibilityBadge
        totalWords={100}
        knownWords={95}
        className="ms-2"
      />
    );
    expect(screen.getByTestId('comprehensibility-badge')).toHaveClass('ms-2');
  });
});
