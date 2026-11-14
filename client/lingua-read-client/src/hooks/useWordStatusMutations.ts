import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DisplayedWord } from '../types/displayedWord';
import { WORD_STATUS_LABELS, type WordStatus } from '../types/wordStatus';
import { createWord, updateWord, type Word } from '../utils/api/words';
import { isOfflineQueued } from '../utils/offline/enqueueIfOffline';
import { subscribeOfflineEvent, subscribeWordReplay, type WordReplayResult } from '../utils/offline/events';
import { drain, removePending, type PendingOp } from '../utils/offline/syncQueue';
import { productionSyncHandlers } from '../utils/offline/handlers';

export type WordStatusTarget = {
  textId: number | string;
  term: string;
  word?: Word | null;
  sentence?: string | null;
};
export type WordStatusIntent = {
  target: WordStatusTarget;
  status: WordStatus;
  // Omitted means status-only; an explicit empty string intentionally clears it.
  translation?: string;
  fillTranslation?: () => Promise<string | undefined>;
};
export type WordStatusMutationState = {
  key: string;
  term: string;
  wordId?: number;
  desiredStatus: number;
  confirmedStatus: number;
  sequence: number;
  confirmedSequence: number;
  pending: boolean;
  queuedOffline: boolean;
  error?: string;
};
export type WordStatusMutationResult = 'confirmed' | 'queued' | 'failed';
type GenerationScope = { key: string | number };
type Request = WordStatusIntent & { generation: GenerationScope; sequence: number; resolve: (result: WordStatusMutationResult) => void };
type QueuedWordOperation = Extract<PendingOp, { type: 'wordCreate' | 'wordStatusUpdate' }> & { id?: number };
type QueuedRequest = { request: Request; op: QueuedWordOperation; translation?: string; active: boolean };
type Entity = WordStatusMutationState & {
  generation: GenerationScope;
  target: WordStatusTarget;
  requests: Request[];
  running: boolean;
  translation?: string;
  confirmedTranslation?: string;
  translationSequence: number;
  lastAppliedTranslation?: string | null;
  lastIntent: WordStatusIntent;
  queuedRequests: QueuedRequest[];
  queuedCreate: boolean;
  retired: boolean;
};
type Callbacks = {
  setWords: Dispatch<SetStateAction<Word[]>>;
  setDisplayedWord: Dispatch<SetStateAction<DisplayedWord | null>>;
  onTranslationSaved?: (target: WordStatusTarget, translation: string) => void;
};
type Args = Callbacks & {
  generation: string | number;
  languageId: string | number;
  lookupTerm: (term: string) => string;
  create?: typeof createWord;
  update?: typeof updateWord;
};

const returnedWord = (result: unknown): Word | undefined =>
  result && typeof result === 'object' ? result as Word : undefined;

// Unfinished persistence outlives reader mounts. UI subscriptions detach on
// navigation; the per-language entity FIFO and queued identity aliases do not.
class WordStatusCoordinator {
  private entities = new Set<Entity>();
  private identities = new Map<string, Entity>();
  private sequence = 0;
  private listener?: (states: WordStatusMutationState[], message?: string) => void;
  private callbacks?: Callbacks;
  private lookupTerm = (term: string) => term;
  private currentGeneration?: GenerationScope;
  private stopReplay = subscribeWordReplay(event => this.replay(event));
  constructor(private args: Pick<Args, 'languageId'> & {
    create: typeof createWord; update: typeof updateWord;
    isSessionActive: () => boolean; onIdle: () => void;
  }) {}
  configure(callbacks: Callbacks, lookupTerm: (term: string) => string, generation: GenerationScope): void {
    this.callbacks = callbacks;
    this.lookupTerm = lookupTerm;
    this.currentGeneration = generation;
    for (const entity of this.entities) {
      if (entity.queuedOffline) entity.generation = generation;
    }
  }
  dispose(): void { this.stopReplay(); }
  subscribe(listener: (states: WordStatusMutationState[], message?: string) => void): () => void {
    this.listener = listener;
    listener(this.states());
    return () => {
      if (this.listener === listener) this.listener = undefined;
      this.args.onIdle();
    };
  }
  isInUse(): boolean { return !!this.listener || [...this.entities].some(entity => entity.running || entity.queuedOffline || entity.requests.length > 0); }

  private naturalKey(term: string): string {
    return `term:${this.args.languageId}:${this.lookupTerm(term)}`;
  }
  private idKey(wordId: number): string { return `id:${this.args.languageId}:${wordId}`; }
  private matches(word: { wordId?: number | string; term?: string | null }, entity: Entity): boolean {
    return word.wordId ? Number(word.wordId) === entity.wordId
      : this.lookupTerm(word.term ?? '') === this.lookupTerm(entity.target.term);
  }
  private identify(entity: Entity, word: Word | undefined): void {
    if (entity.retired || !word?.wordId) return;
    entity.wordId = word.wordId;
    this.identities.set(this.idKey(word.wordId), entity);
  }
  private entityFor(target: WordStatusTarget, intent: WordStatusIntent, generation: GenerationScope): Entity {
    const key = target.word?.wordId ? this.idKey(target.word.wordId) : this.naturalKey(target.term);
    let entity = this.identities.get(key);
    if (!entity) {
      entity = {
        key, generation, target: { ...target, word: target.word ? { ...target.word } : null }, term: target.term,
        wordId: target.word?.wordId || undefined, desiredStatus: target.word?.status ?? 0,
        confirmedStatus: target.word?.status ?? 0, sequence: 0, confirmedSequence: 0,
        pending: false, queuedOffline: false, queuedCreate: false, queuedRequests: [], retired: false, requests: [], running: false,
        confirmedTranslation: target.word?.translation ?? undefined,
        lastAppliedTranslation: target.word?.translation, translationSequence: 0, lastIntent: intent,
      };
      this.entities.add(entity);
      this.identities.set(key, entity);
    }
    return entity;
  }
  private publish(entity: Entity, message?: string, forceTranslation = false): void {
    if (entity.retired || !this.args.isSessionActive() || !this.listener || !this.callbacks || entity.generation !== this.currentGeneration) return;
    const snapshot = { ...entity };
    const previousTranslation = entity.lastAppliedTranslation;
    const patch = <T extends { wordId?: number | string; term?: string | null; translation?: string | null }>(word: T): T => ({
      ...word, ...(snapshot.wordId ? { wordId: snapshot.wordId } : {}),
      status: snapshot.desiredStatus, offline: snapshot.queuedOffline,
      isNew: !snapshot.wordId && !snapshot.queuedOffline && snapshot.desiredStatus === 0,
      ...(snapshot.translation !== undefined && (forceTranslation || word.translation == null || word.translation === '' ||
        word.translation === previousTranslation) ? { translation: snapshot.translation } : {}),
    });
    const callbacks = this.callbacks;
    callbacks.setWords(current => {
      if (entity.retired) return current;
      let found = false;
      const next = current.map(word => {
        if (!this.matches(word, snapshot)) return word;
        found = true;
        return patch(word);
      });
      return found ? next : [...next, patch({ ...snapshot.target.word, term: snapshot.target.term })];
    });
    callbacks.setDisplayedWord(current => !entity.retired && current && this.matches(current, snapshot) ? patch(current) : current);
    if (entity.translation !== undefined) entity.lastAppliedTranslation = entity.translation;
    this.listener(this.states(), message);
  }
  states(): WordStatusMutationState[] {
    return [...this.entities].filter(entity => entity.generation === this.currentGeneration).map(({ key, term, wordId, desiredStatus, confirmedStatus, sequence,
      confirmedSequence, pending, queuedOffline, error }) => ({ key, term, wordId, desiredStatus,
      confirmedStatus, sequence, confirmedSequence, pending, queuedOffline, error }));
  }
  version = (): number => this.sequence;

  private queueKey(op: QueuedWordOperation): string {
    return op.type === 'wordStatusUpdate' ? `id:${op.payload.wordId}` : `term:${op.payload.textId}:${op.payload.term}`;
  }
  private updateQueuedState(entity: Entity): void {
    entity.queuedOffline = entity.queuedRequests.some(item => item.active);
    entity.queuedCreate = entity.queuedRequests.some(item => item.active && item.op.type === 'wordCreate');
  }

  // Deletion retires every alias and unsent intent of this entity. In-flight
  // completions may finish persistence, but cannot republish or reclaim an ID.
  retire = async (word: { wordId?: number | string; term?: string | null }): Promise<void> => {
    const entity = word.wordId ? this.identities.get(this.idKey(Number(word.wordId)))
      : this.identities.get(this.naturalKey(word.term ?? ''));
    const queuedIds = new Set(entity?.queuedRequests.map(item => item.op.id).filter(id => id !== undefined));
    if (entity) {
      entity.retired = true;
      entity.requests.splice(0).forEach(request => request.resolve('failed'));
      entity.queuedRequests = [];
      this.entities.delete(entity);
      for (const [key, owner] of this.identities) if (owner === entity) this.identities.delete(key);
      this.listener?.(this.states(), `${entity.term} deleted.`);
    }
    try {
      await removePending(op => queuedIds.has(op.id) ||
        (op.type === 'wordStatusUpdate' && !!word.wordId && op.payload.wordId === Number(word.wordId)));
    } catch { /* Unavailable local storage must not undo a successful server deletion. */ }
    this.args.onIdle();
  };

  mutate = (intent: WordStatusIntent, generation: GenerationScope): Promise<WordStatusMutationResult> => {
    if (!this.args.isSessionActive()) return Promise.resolve('failed');
    // Capture the complete intent before translation or persistence can await.
    const captured = { ...intent, target: { ...intent.target, word: intent.target.word ? { ...intent.target.word } : null } };
    const entity = this.entityFor(captured.target, captured, generation);
    const sequence = ++this.sequence;
    entity.sequence = sequence;
    entity.generation = generation;
    entity.desiredStatus = captured.status;
    entity.pending = true;
    entity.error = undefined;
    entity.lastIntent = captured;
    if (captured.translation !== undefined) {
      entity.translation = captured.translation;
      entity.translationSequence = sequence;
    }
    const result = new Promise<WordStatusMutationResult>(resolve => {
      entity.requests.push({ ...captured, generation, sequence, resolve });
    });
    this.publish(entity, `Saving ${entity.term}: ${WORD_STATUS_LABELS[captured.status]}.`, captured.translation !== undefined);
    void this.run(entity);
    return result;
  };

  private async run(entity: Entity): Promise<void> {
    if (entity.running) return;
    entity.running = true;
    while (entity.requests.length) {
      const request = entity.requests.shift()!;
      try {
        if (entity.retired || !this.args.isSessionActive()) throw new Error('Session ended or term deleted.');
        let translation = request.translation;
        if (translation === undefined && request.fillTranslation && !entity.confirmedTranslation &&
          (entity.translation === undefined || (entity.translation === '' && entity.translationSequence === 0))) {
          try { translation = await request.fillTranslation(); } catch { /* A translation failure must not discard the status intent. */ }
          // A later explicit translation owns the field, even if this provider
          // result arrives first. Never send its older/empty fill over that edit.
          if (entity.translationSequence > request.sequence) translation = undefined;
        }
        if (entity.retired || !this.args.isSessionActive()) throw new Error('Session ended or term deleted.');
        const creating = !entity.wordId || entity.queuedCreate;
        const createArgs: Parameters<typeof createWord> = [
          request.target.textId, entity.target.term, request.status, translation, request.target.sentence ?? null,
        ];
        // Provisional creates have passage-scoped queue keys. A later passage
        // must join the FIFO even after an older replay has supplied an ID.
        if (entity.queuedOffline) createArgs[5] = { queueOnly: true };
        const result = creating
          ? await this.args.create(...createArgs)
          : await this.args.update(entity.wordId!, request.status, translation);
        if (entity.retired) {
          if (isOfflineQueued(result) && result.queuedOp?.id !== undefined) {
            const id = result.queuedOp.id;
            await removePending(op => op.id === id);
          }
          request.resolve('failed');
          continue;
        }
        if (isOfflineQueued(result)) {
          const op: QueuedWordOperation = result.queuedOp?.type === 'wordCreate' || result.queuedOp?.type === 'wordStatusUpdate'
            ? result.queuedOp : creating
              ? { type: 'wordCreate', payload: { textId: Number(request.target.textId), term: entity.target.term.trim(), status: request.status, translation } }
              : { type: 'wordStatusUpdate', payload: { wordId: entity.wordId!, status: request.status, translation } };
          const previous = [...entity.queuedRequests].reverse().find(item => item.active && this.queueKey(item.op) === this.queueKey(op));
          if (previous) previous.active = false;
          entity.queuedRequests.push({ request, op, translation: translation ?? previous?.translation, active: true });
          this.updateQueuedState(entity);
        } else {
          this.identify(entity, returnedWord(result));
          entity.confirmedStatus = request.status;
          entity.confirmedSequence = request.sequence;
          if (translation !== undefined) entity.confirmedTranslation = translation;
        }
        if (translation !== undefined && entity.translationSequence <= request.sequence) {
          entity.translation = translation;
          if (this.args.isSessionActive() && this.listener && request.generation === this.currentGeneration) this.callbacks?.onTranslationSaved?.(request.target, translation);
        }
        entity.pending = entity.requests.length > 0;
        this.publish(entity, entity.sequence === request.sequence
          ? `${entity.term}: ${isOfflineQueued(result) ? 'Queued offline' : WORD_STATUS_LABELS[request.status] + ' saved'}.` : undefined);
        request.resolve(isOfflineQueued(result) ? 'queued' : 'confirmed');
      } catch {
        if (!entity.retired && entity.sequence === request.sequence) {
          entity.desiredStatus = entity.confirmedStatus;
          entity.translation = entity.confirmedTranslation;
          entity.error = `Could not save ${entity.term}. Retry.`;
        }
        entity.pending = entity.requests.length > 0;
        this.publish(entity, entity.error);
        request.resolve('failed');
      }
    }
    entity.running = false;
    this.args.onIdle();
  }

  retry = async (key: string, generation: GenerationScope): Promise<void> => {
    if (!this.args.isSessionActive()) return;
    const entity = [...this.entities].find(item => item.key === key);
    if (!entity) return;
    if (entity.queuedOffline) {
      entity.error = undefined;
      this.publish(entity, `${entity.term}: Queued offline.`);
      await drain(productionSyncHandlers);
    } else await this.mutate(entity.lastIntent, generation);
  };

  // A read only confirms queued work when the actual entity/status matches.
  // Generic sync-complete alone is never a confirmation.
  reconcileServerWords = (saved: Word[]): void => {
    for (const entity of this.entities) {
      const matches = saved.filter(word => entity.wordId ? word.wordId === entity.wordId
        : this.lookupTerm(word.term ?? '') === this.lookupTerm(entity.target.term));
      const word = matches.length === 1 ? matches[0] : undefined;
      if (word) this.identify(entity, word);
      if (entity.queuedOffline && !entity.pending) {
        const queued = [...entity.queuedRequests].reverse().find(item => item.active);
        if (word && word.status === entity.desiredStatus &&
          // useSyncedWordIdentities checks that the shared queue is empty both
          // before and after this read, including when another tab replayed it.
          (queued?.translation === undefined || word.translation === queued.translation)) {
          entity.confirmedStatus = word.status ?? 0;
          entity.confirmedSequence = entity.sequence;
          entity.confirmedTranslation = word.translation ?? undefined;
          entity.queuedRequests = [];
          this.updateQueuedState(entity);
          entity.error = undefined;
          this.publish(entity, `${entity.term}: ${WORD_STATUS_LABELS[entity.desiredStatus as WordStatus]} saved.`);
        } else {
          entity.error = `Could not confirm ${entity.term}. Retry.`;
          this.publish(entity, entity.error);
        }
      } else if (word) this.publish(entity);
    }
  };

  replay = ({ op, outcome, result }: WordReplayResult): void => {
    const entity = op.type === 'wordStatusUpdate'
      ? this.identities.get(this.idKey(op.payload.wordId))
      : this.identities.get(this.naturalKey(op.payload.term));
    if (!entity || entity.retired) return;
    const queued = entity.queuedRequests.find(item => item.op.id !== undefined ? item.op.id === op.id
      : this.queueKey(item.op) === this.queueKey(op) && item.request.status === op.payload.status && item.translation === op.payload.translation);
    if (!queued) return;
    const latest = queued.active && queued.request.sequence === entity.sequence;
    if (outcome === 'confirmed') {
      this.identify(entity, returnedWord(result));
      if (queued.request.sequence >= entity.confirmedSequence) {
        entity.confirmedStatus = op.payload.status ?? queued.request.status;
        entity.confirmedSequence = queued.request.sequence;
        entity.confirmedTranslation = op.payload.translation ?? entity.confirmedTranslation;
      }
      entity.queuedRequests = entity.queuedRequests.filter(item => item !== queued);
      this.updateQueuedState(entity);
      if (latest) {
        entity.error = undefined;
      }
      this.publish(entity, latest && !entity.pending && !entity.queuedOffline && entity.generation === this.currentGeneration
        ? `${entity.term}: ${WORD_STATUS_LABELS[queued.request.status]} saved.` : undefined);
    } else {
      if (outcome === 'rejected') {
        entity.queuedRequests = entity.queuedRequests.filter(item => item !== queued);
        this.updateQueuedState(entity);
        if (latest && !entity.pending) entity.desiredStatus = entity.confirmedStatus;
      }
      if (latest && !entity.pending) {
        entity.error = `Could not save ${entity.term}. Retry.`;
        this.publish(entity, entity.error);
      } else this.publish(entity);
    }
    this.args.onIdle();
  };

  reconcileWords = (saved: Word[], current: Word[], readVersion = 0): Word[] => {
    const next = [...saved];
    for (const entity of this.entities) {
      if (!entity.pending && !entity.queuedOffline && entity.sequence <= readVersion) {
        const confirmed = saved.find(word => this.matches(word, entity));
        if (confirmed) {
          entity.confirmedStatus = confirmed.status ?? 0;
          entity.desiredStatus = confirmed.status ?? 0;
          entity.confirmedTranslation = confirmed.translation ?? undefined;
        }
        continue;
      }
      const local = current.find(word => this.matches(word, entity));
      const index = next.findIndex(word => this.matches(word, entity));
      const protectedWord = { ...(index >= 0 ? next[index] : entity.target.word), ...local,
        term: local?.term ?? entity.target.term, ...(entity.wordId ? { wordId: entity.wordId } : {}), status: entity.desiredStatus };
      if (index >= 0) next[index] = protectedWord;
      else next.push(protectedWord);
    }
    return next;
  };
}

// Keep only owned or unfinished persistence. A reader remount can join an
// unfinished entity without sharing any old generation's UI subscription.
class ReaderWordMutationSession {
  private languages = new Map<string, WordStatusCoordinator>();
  active = true;
  constructor(private onEmpty: () => void) {}
  end(): void {
    this.active = false;
    for (const coordinator of this.languages.values()) coordinator.dispose();
    this.languages.clear(); this.onEmpty();
  }
  forLanguage(languageId: string | number, create: typeof createWord, update: typeof updateWord): WordStatusCoordinator {
    const key = String(languageId);
    let coordinator = this.languages.get(key);
    if (!coordinator) {
      coordinator = new WordStatusCoordinator({ languageId, create, update,
        isSessionActive: () => this.active,
        onIdle: () => queueMicrotask(() => {
          if (!coordinator || this.languages.get(key) !== coordinator || coordinator.isInUse()) return;
          coordinator.dispose();
          this.languages.delete(key);
          if (this.languages.size === 0) this.onEmpty();
        }),
      });
      this.languages.set(key, coordinator);
    }
    return coordinator;
  }
}
let sharedSession: ReaderWordMutationSession | undefined;
function readerMutationSession(): ReaderWordMutationSession {
  if (sharedSession?.active) return sharedSession;
  const session = new ReaderWordMutationSession(() => {
    if (sharedSession === session) sharedSession = undefined;
    stop();
  });
  const stop = subscribeOfflineEvent('session-ended', () => session.end());
  sharedSession = session;
  return session;
}

export function useWordStatusMutations({ generation, languageId, lookupTerm, create = createWord, update = updateWord,
  ...callbacks }: Args) {
  const [session] = useState(readerMutationSession);
  const generationScope = useMemo(() => ({ key: generation }), [generation]);
  const coordinator = useMemo(() => session.forLanguage(languageId, create, update), [session, languageId, create, update]);
  useLayoutEffect(() => { coordinator.configure(callbacks, lookupTerm, generationScope); });
  const mutate = useCallback((intent: WordStatusIntent) => coordinator.mutate(intent, generationScope), [coordinator, generationScope]);
  const retry = useCallback((key: string) => coordinator.retry(key, generationScope), [coordinator, generationScope]);
  const [view, setView] = useState<{ owner: WordStatusCoordinator; generation: GenerationScope; states: WordStatusMutationState[]; message: string }>();
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let message = '';
    const detach = coordinator.subscribe((states, nextMessage) => {
      setView(current => ({ owner: coordinator, generation: generationScope, states,
        message: current?.owner === coordinator && current.generation === generationScope ? current.message : '' }));
      if (!nextMessage) return;
      message = nextMessage;
      clearTimeout(timer);
      timer = setTimeout(() => setView({ owner: coordinator, generation: generationScope, states: coordinator.states(), message }), 150);
    });
    return () => { detach(); clearTimeout(timer); };
  }, [coordinator, generationScope]);
  return {
    mutate, retry, retire: coordinator.retire, reconcileWords: coordinator.reconcileWords,
    reconcileServerWords: coordinator.reconcileServerWords, version: coordinator.version,
    states: view?.owner === coordinator && view.generation === generationScope ? view.states : [],
    announcement: view?.owner === coordinator && view.generation === generationScope ? view.message : '',
  };
}
