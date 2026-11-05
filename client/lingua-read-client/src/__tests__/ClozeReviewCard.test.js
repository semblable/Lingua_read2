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

  test('renders the meaning cue on the front face when translation is provided', () => {
    render(<ClozeReviewCard {...baseProps} translation="gato" />);
    expect(screen.getByTestId('cloze-meaning-cue')).toHaveTextContent('Meaning:gato');
  });

  test('hides the meaning cue on the front face when translation is empty', () => {
    render(<ClozeReviewCard {...baseProps} translation="" />);
    expect(screen.queryByTestId('cloze-meaning-cue')).not.toBeInTheDocument();
  });

  test('renders scaffold slots matching the target word length', () => {
    render(<ClozeReviewCard {...baseProps} term="cat" />);
    const slots = screen.getAllByTestId('cloze-letter-slot');
    expect(slots).toHaveLength(3);
    slots.forEach((slot) => {
      expect(slot).toHaveTextContent('_');
      expect(slot).toHaveAttribute('data-revealed', 'false');
      expect(slot).toHaveAttribute('data-is-letter', 'true');
    });
  });

  test('preserves spaces and punctuation in the scaffold while masking letters', () => {
    render(<ClozeReviewCard {...baseProps} term="l'eau" />);
    const slots = screen.getAllByTestId('cloze-letter-slot');
    expect(slots).toHaveLength(5);
    // slot 0: 'l' -> unrevealed
    expect(slots[0]).toHaveTextContent('_');
    expect(slots[0]).toHaveAttribute('data-is-letter', 'true');
    // slot 1: '\'' -> literal punctuation
    expect(slots[1]).toHaveTextContent("'");
    expect(slots[1]).toHaveAttribute('data-is-letter', 'false');
    expect(slots[1]).toHaveAttribute('data-revealed', 'true');
    // slots 2, 3, 4: 'e', 'a', 'u' -> unrevealed
    expect(slots[2]).toHaveTextContent('_');
    expect(slots[3]).toHaveTextContent('_');
    expect(slots[4]).toHaveTextContent('_');
  });

  test('reveals letters progressively when clicking the Hint button and updates the input', () => {
    const onHintUsed = vi.fn();
    render(<ClozeReviewCard {...baseProps} term="cat" onHintUsed={onHintUsed} />);
    const hintButton = screen.getByTestId('cloze-hint-button');
    const input = screen.getByTestId('cloze-input');

    // Hint 1: reveals 'c'
    fireEvent.click(hintButton);
    expect(input).toHaveValue('c');
    expect(screen.getByTestId('cloze-hint-counter')).toHaveTextContent('1/3 hints');
    expect(onHintUsed).toHaveBeenCalledWith(1, 3);

    const slotsAfter1 = screen.getAllByTestId('cloze-letter-slot');
    expect(slotsAfter1[0]).toHaveTextContent('c');
    expect(slotsAfter1[0]).toHaveAttribute('data-revealed', 'true');
    expect(slotsAfter1[1]).toHaveTextContent('_');
    expect(slotsAfter1[2]).toHaveTextContent('_');

    // Hint 2: reveals 'a'
    fireEvent.click(hintButton);
    expect(input).toHaveValue('ca');
    expect(screen.getByTestId('cloze-hint-counter')).toHaveTextContent('2/3 hints');
    expect(onHintUsed).toHaveBeenCalledWith(2, 3);

    // Hint 3: reveals 't'
    fireEvent.click(hintButton);
    expect(input).toHaveValue('cat');
    expect(screen.getByTestId('cloze-hint-counter')).toHaveTextContent('3/3 hints');
    expect(onHintUsed).toHaveBeenCalledWith(3, 3);

    // Once all letters are revealed, Hint button is disabled
    expect(hintButton).toBeDisabled();
  });

  test('Alt+H shortcut triggers letter reveal', () => {
    render(<ClozeReviewCard {...baseProps} term="dog" />);
    const input = screen.getByTestId('cloze-input');

    fireEvent.keyDown(input, { key: 'h', altKey: true });
    expect(input).toHaveValue('d');
    expect(screen.getByTestId('cloze-hint-counter')).toHaveTextContent('1/3 hints');
  });

  test('supports diacritic-tolerant matching (e.g. cafe matches café)', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} term="café" />);
    const input = screen.getByTestId('cloze-input');
    fireEvent.change(input, { target: { value: 'cafe' } });
    rerender(<ClozeReviewCard {...baseProps} term="café" isFlipped={true} />);

    const userAnswer = screen.getByTestId('cloze-user-answer');
    expect(userAnswer).toHaveTextContent('cafe');
    expect(userAnswer).toHaveAttribute('data-cloze-match', 'true');
    expect(screen.getByText(/accent difference from café/i)).toBeInTheDocument();
  });

  test('displays hint usage badge and recommended grade advice on the back face', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} term="cat" />);
    const hintButton = screen.getByTestId('cloze-hint-button');

    // Use 1 hint
    fireEvent.click(hintButton);
    rerender(<ClozeReviewCard {...baseProps} term="cat" isFlipped={true} />);

    const hintUsage = screen.getByTestId('cloze-hint-usage');
    expect(hintUsage).toHaveTextContent('1 of 3 letters revealed');
    expect(screen.getByTestId('cloze-grade-advice')).toHaveTextContent(/Scaffolded recall/i);
  });

  test('full reveal suggests Again on the back face', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} term="cat" />);
    const hintButton = screen.getByTestId('cloze-hint-button');

    // Use all 3 hints
    fireEvent.click(hintButton);
    fireEvent.click(hintButton);
    fireEvent.click(hintButton);
    rerender(<ClozeReviewCard {...baseProps} term="cat" isFlipped={true} />);

    expect(screen.getByTestId('cloze-hint-usage')).toHaveTextContent('3 of 3 letters revealed');
    expect(screen.getByTestId('cloze-grade-advice')).toHaveTextContent(/Full reveal — Recommended grade: Again/i);
  });

  test('resets hint state when cardId changes', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} cardId={1} term="cat" />);
    const hintButton = screen.getByTestId('cloze-hint-button');
    fireEvent.click(hintButton);
    expect(screen.getByTestId('cloze-input')).toHaveValue('c');

    rerender(<ClozeReviewCard {...baseProps} cardId={2} term="dog" />);
    expect(screen.getByTestId('cloze-input')).toHaveValue('');
    expect(screen.getByTestId('cloze-hint-counter')).toHaveTextContent(/Alt\+H for hint/i);
    const slots = screen.getAllByTestId('cloze-letter-slot');
    expect(slots[0]).toHaveTextContent('_');
  });

  test('resets answer and hint state when the same cardId transitions from flipped back to unflipped', () => {
    const { rerender } = render(<ClozeReviewCard {...baseProps} cardId={1} term="cat" isFlipped={false} />);
    fireEvent.click(screen.getByTestId('cloze-hint-button'));
    fireEvent.change(screen.getByTestId('cloze-input'), { target: { value: 'ca' } });
    expect(screen.getByTestId('cloze-input')).toHaveValue('ca');

    // Flip to back face
    rerender(<ClozeReviewCard {...baseProps} cardId={1} term="cat" isFlipped={true} />);
    expect(screen.getByTestId('cloze-user-answer')).toHaveTextContent('ca');

    // Re-queue same card on a learning step (isFlipped returns to false with same cardId)
    rerender(<ClozeReviewCard {...baseProps} cardId={1} term="cat" isFlipped={false} />);
    expect(screen.getByTestId('cloze-input')).toHaveValue('');
    expect(screen.getByTestId('cloze-hint-counter')).toHaveTextContent(/Alt\+H for hint/i);
    const slots = screen.getAllByTestId('cloze-letter-slot');
    expect(slots[0]).toHaveTextContent('_');
  });

  test('groups combining diacritics with their base letter into a single maskable grapheme slot', () => {
    // Decomposed "café" (e + U+0301 combining acute accent) should have 4 slots, not 5
    const decomposedCafe = 'cafe\u0301';
    render(<ClozeReviewCard {...baseProps} term={decomposedCafe} />);
    const slots = screen.getAllByTestId('cloze-letter-slot');
    expect(slots).toHaveLength(4);
    slots.forEach((slot) => {
      expect(slot).toHaveTextContent('_');
      expect(slot).toHaveAttribute('data-is-letter', 'true');
    });
  });
});
