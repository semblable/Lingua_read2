// The order cards come up in during one SRS review session.
//
// A card on a (re)learning step comes back minutes later — "Again" on a new card
// means "show me again in 1 minute", not "tomorrow". The server returns each
// graded card's next due time; cards due within the learn-ahead window go back
// into this queue and are shown when due, or early once nothing else is left
// (Anki's "learn ahead limit"). Pure and immutable so it can live in React state.

export const LEARN_AHEAD_MS = 20 * 60 * 1000;

export interface PendingLearningCard<T> {
  card: T;
  dueAt: number;
}

export interface SessionQueue<T> {
  /** Cards not shown yet this session, in the server's order. */
  unseen: readonly T[];
  /** Cards waiting on a (re)learning step, earliest first. */
  learning: readonly PendingLearningCard<T>[];
}

const insertByDue = <T>(
  learning: readonly PendingLearningCard<T>[],
  entry: PendingLearningCard<T>
): PendingLearningCard<T>[] => {
  const index = learning.findIndex((pending) => pending.dueAt > entry.dueAt);
  return index === -1
    ? [...learning, entry]
    : [...learning.slice(0, index), entry, ...learning.slice(index)];
};

/**
 * Builds the queue from the server's due list. `learningDueAt` returns when a
 * card on a learning step is due (null for other cards); the server also sends
 * learning cards due within the learn-ahead window, and those wait their turn.
 */
export function createSessionQueue<T>(
  cards: readonly T[],
  learningDueAt: (card: T) => number | null,
  now: number
): SessionQueue<T> {
  const unseen: T[] = [];
  let learning: PendingLearningCard<T>[] = [];
  for (const card of cards) {
    const dueAt = learningDueAt(card);
    if (dueAt != null && dueAt > now) learning = insertByDue(learning, { card, dueAt });
    else unseen.push(card);
  }
  return { unseen, learning };
}

/**
 * The next card to show: a learning card that is due, else the next unseen
 * card, else the earliest pending learning card shown ahead of time.
 */
export function nextCard<T>(queue: SessionQueue<T>, now: number): T | null {
  const firstLearning = queue.learning[0];
  if (firstLearning && firstLearning.dueAt <= now) return firstLearning.card;
  if (queue.unseen.length > 0) return queue.unseen[0];
  return firstLearning ? firstLearning.card : null;
}

/** Removes `card` from the queue (it's being shown, suspended or buried). */
export function takeCard<T>(queue: SessionQueue<T>, card: T): SessionQueue<T> {
  return {
    unseen: queue.unseen.filter((c) => c !== card),
    learning: queue.learning.filter((pending) => pending.card !== card),
  };
}

/**
 * Puts a graded card back if it's due again within the learn-ahead window;
 * otherwise it's done for this session and the queue is returned unchanged.
 */
export function requeue<T>(queue: SessionQueue<T>, card: T, dueAt: number, now: number): SessionQueue<T> {
  if (dueAt - now > LEARN_AHEAD_MS) return queue;
  return { unseen: queue.unseen, learning: insertByDue(queue.learning, { card, dueAt }) };
}

export function remainingCount<T>(queue: SessionQueue<T>): number {
  return queue.unseen.length + queue.learning.length;
}

/** Shortest readable form of an interval: 45s, 10m, 5h, 3d, 2.5mo, 1.2y. */
export function formatInterval(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;
  const trim = (value: number): string => (value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10));
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (minutes < 60) return `${trim(minutes)}m`;
  if (hours < 24) return `${trim(hours)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${trim(days / 30)}mo`;
  return `${trim(days / 365)}y`;
}
