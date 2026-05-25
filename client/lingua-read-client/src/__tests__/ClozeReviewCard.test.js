import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ClozeReviewCard from '../components/srs/ClozeReviewCard';

const baseProps = {
  cardId: 1,
  clozeSentence: 'The ___ sat on the mat.',
  term: 'cat',
  translation: 'gato',
  isFlipped: false,
  onReveal: () => {},
};

describe('ClozeReviewCard', () => {
  test('renders the cloze sentence with input visible and answer hidden', () => {
    render(<ClozeReviewCard {...baseProps} />);
    expect(screen.getByTestId('cloze-sentence')).toHaveTextContent('The ___ sat on the mat.');
    expect(screen.getByTestId('cloze-input')).toBeInTheDocument();
    expect(screen.queryByTestId('cloze-expected')).not.toBeInTheDocument();
  });

  test('Enter in the input calls onReveal', () => {
    const onReveal = vi.fn();
    render(<ClozeReviewCard {...baseProps} onReveal={onReveal} />);
    const input = screen.getByTestId('cloze-input');
    fireEvent.change(input, { target: { value: 'cat' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  test('non-Enter keys do not trigger reveal', () => {
    const onReveal = vi.fn();
    render(<ClozeReviewCard {...baseProps} onReveal={onReveal} />);
    const input = screen.getByTestId('cloze-input');
    fireEvent.change(input, { target: { value: 'ca' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(onReveal).not.toHaveBeenCalled();
  });

  test('after flip, shows the expected answer alongside the user input', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} />);
    const input = screen.getByTestId('cloze-input');
    fireEvent.change(input, { target: { value: 'CAT' } });
    rerender(<ClozeReviewCard {...baseProps} isFlipped={true} />);

    expect(screen.getByTestId('cloze-user-answer')).toHaveTextContent('CAT');
    expect(screen.getByTestId('cloze-user-answer')).toHaveAttribute('data-cloze-match', 'true');
  });

  test('after flip with a wrong answer, marks the user answer as not matched', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} />);
    fireEvent.change(screen.getByTestId('cloze-input'), { target: { value: 'dog' } });
    rerender(<ClozeReviewCard {...baseProps} isFlipped={true} />);

    const userAnswer = screen.getByTestId('cloze-user-answer');
    expect(userAnswer).toHaveTextContent('dog');
    expect(userAnswer).toHaveAttribute('data-cloze-match', 'false');
    expect(screen.getByTestId('cloze-expected')).toHaveTextContent('cat');
  });

  test('shows the expected answer even when user typed nothing', () => {
    render(<ClozeReviewCard {...baseProps} isFlipped={true} />);
    expect(screen.queryByTestId('cloze-comparison')).not.toBeInTheDocument();
    expect(screen.getByTestId('cloze-expected')).toHaveTextContent('cat');
  });

  test('shows the translation on the back face', () => {
    render(<ClozeReviewCard {...baseProps} isFlipped={true} />);
    expect(screen.getByText('gato')).toBeInTheDocument();
  });

  test('falls back to "No translation" placeholder when translation is empty', () => {
    render(<ClozeReviewCard {...baseProps} translation="" isFlipped={true} />);
    expect(screen.getByText(/No translation/i)).toBeInTheDocument();
  });

  test('resets the typed answer when cardId changes', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} />);
    fireEvent.change(screen.getByTestId('cloze-input'), { target: { value: 'dog' } });
    expect(screen.getByTestId('cloze-input')).toHaveValue('dog');

    rerender(<ClozeReviewCard {...baseProps} cardId={2} />);
    expect(screen.getByTestId('cloze-input')).toHaveValue('');
  });

  test('renders other mined sentences on the back face', () => {
    render(
      <ClozeReviewCard
        {...baseProps}
        isFlipped={true}
        otherPhrases={[
          { srsPhraseId: 1, sentence: 'A cat is a cat.' },
          { srsPhraseId: 2, sentence: 'My cat sleeps.' },
        ]}
      />
    );
    expect(screen.getByText(/Other mined sentences:/i)).toBeInTheDocument();
    expect(screen.getByText('"A cat is a cat."')).toBeInTheDocument();
    expect(screen.getByText('"My cat sleeps."')).toBeInTheDocument();
  });

  test('autofocuses the input on the front face', () => {
    render(<ClozeReviewCard {...baseProps} />);
    expect(screen.getByTestId('cloze-input')).toHaveFocus();
  });

  test('matching ignores leading/trailing whitespace and case', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} />);
    fireEvent.change(screen.getByTestId('cloze-input'), { target: { value: '  Cat  ' } });
    rerender(<ClozeReviewCard {...baseProps} isFlipped={true} />);
    expect(screen.getByTestId('cloze-user-answer')).toHaveAttribute('data-cloze-match', 'true');
  });
});
