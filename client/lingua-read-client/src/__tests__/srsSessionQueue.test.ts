import { describe, it, expect } from 'vitest';
import {
  LEARN_AHEAD_MS,
  createSessionQueue,
  formatInterval,
  nextCard,
  remainingCount,
  requeue,
  takeCard,
} from '../utils/srsSessionQueue';

type Card = { id: string; learningDueAt?: number };

const NOW = 1_000_000;
const dueAt = (card: Card) => card.learningDueAt ?? null;
const card = (id: string, learningDueAt?: number): Card => ({ id, learningDueAt });

describe('srsSessionQueue', () => {
  it('serves cards in server order', () => {
    const a = card('a');
    const b = card('b');
    const queue = createSessionQueue([a, b], dueAt, NOW);

    expect(nextCard(queue, NOW)).toBe(a);
    expect(nextCard(takeCard(queue, a), NOW)).toBe(b);
    expect(nextCard(takeCard(takeCard(queue, a), b), NOW)).toBeNull();
  });

  it('holds learning cards the server sent ahead of time until nothing else is left', () => {
    const early = card('early', NOW + 5 * 60_000);
    const dueNow = card('due', NOW - 1);
    const plain = card('plain');
    const queue = createSessionQueue([early, dueNow, plain], dueAt, NOW);

    expect(queue.learning.map((p) => p.card)).toEqual([early]);
    expect(nextCard(queue, NOW)).toBe(dueNow);
    const afterTwo = takeCard(takeCard(queue, dueNow), plain);
    expect(nextCard(afterTwo, NOW)).toBe(early); // learn ahead
  });

  it('brings a requeued card back once it is due, ahead of unseen cards', () => {
    const graded = card('graded');
    const next = card('next');
    const later = card('later');
    let queue = createSessionQueue([next, later], dueAt, NOW);

    queue = requeue(queue, graded, NOW + 60_000, NOW);
    expect(nextCard(queue, NOW)).toBe(next);
    expect(nextCard(queue, NOW + 60_000)).toBe(graded);
    expect(remainingCount(queue)).toBe(3);
  });

  it('keeps requeued cards ordered by due time', () => {
    const tenMinutes = card('10m');
    const oneMinute = card('1m');
    let queue = createSessionQueue<Card>([], dueAt, NOW);
    queue = requeue(queue, tenMinutes, NOW + 10 * 60_000, NOW);
    queue = requeue(queue, oneMinute, NOW + 60_000, NOW);

    expect(queue.learning.map((p) => p.card)).toEqual([oneMinute, tenMinutes]);
    expect(nextCard(queue, NOW)).toBe(oneMinute);
  });

  it('drops cards due beyond the learn-ahead window: they are done for this session', () => {
    const graded = card('graded');
    const queue = createSessionQueue<Card>([], dueAt, NOW);

    expect(requeue(queue, graded, NOW + LEARN_AHEAD_MS + 1, NOW)).toBe(queue);
    expect(remainingCount(requeue(queue, graded, NOW + LEARN_AHEAD_MS, NOW))).toBe(1);
  });

  it('takeCard removes a card from either list without touching the input', () => {
    const a = card('a');
    const b = card('b', NOW + 60_000);
    const queue = createSessionQueue([a, b], dueAt, NOW);

    const withoutB = takeCard(queue, b);
    expect(withoutB.learning).toEqual([]);
    expect(withoutB.unseen).toEqual([a]);
    expect(queue.learning).toHaveLength(1);
  });

  it.each([
    [null, ''],
    [30, '30s'],
    [60, '1m'],
    [330, '5.5m'],
    [600, '10m'],
    [3 * 3600, '3h'],
    [86_400, '1d'],
    [12 * 86_400, '12d'],
    [45 * 86_400, '1.5mo'],
    [400 * 86_400, '1.1y'],
  ] as Array<[number | null, string]>)('formatInterval(%s) is %s', (seconds, expected) => {
    expect(formatInterval(seconds)).toBe(expected);
  });
});
