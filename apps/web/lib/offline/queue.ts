/**
 * Offline mutation queue (EF §2.2 sync protocol v1).
 *
 * "Client queues mutations locally; on reconnect, replays in order." That is the
 * whole design, and its safety comes from upstream: every mutation is an
 * idempotent `PUT /api/v1/brews/{client_uuid}`, so a replay can duplicate the
 * *request* but never the *brew*.
 *
 * Queue rules:
 *  - keyed by `type:id`, so editing a session that has not synced yet replaces
 *    the queued body instead of adding a second entry (one brew, one entry);
 *  - replayed oldest-first by queue time (UUIDv7 ids sort the same way);
 *  - a transport failure (offline) pauses the drain and schedules a backoff —
 *    there is no point walking the rest of the queue through a dead socket;
 *  - a permanent failure (4xx that is not 408/429) is dropped after being
 *    recorded, because retrying a rejected body forever is a battery leak.
 */
import type { SyncResourceType } from '@brewcult/shared-types';
import type { OfflineStore } from './store';

export const QUEUE_PREFIX = 'queue:';

export interface QueuedMutation {
  /** Resource id — client-minted UUIDv7. The dedupe key, with `type`. */
  id: string;
  type: SyncResourceType;
  /** Public API path, always `/api/...` (see lib/api.ts). */
  path: string;
  method: 'PUT' | 'POST' | 'DELETE';
  body: unknown;
  queued_at: string;
  attempts: number;
  /** Epoch ms; the drain skips entries that are not due yet. */
  next_attempt_at: number;
  last_error?: string;
}

export interface QueueState {
  pending: number;
  /** A drain is running right now. */
  syncing: boolean;
  /** Set when the last attempt failed; cleared on the next success. */
  lastError: string | null;
  /** Epoch ms of the last fully successful drain. */
  lastSyncedAt: number | null;
  /** Mutations abandoned because the server rejected them outright. */
  dropped: number;
}

export type QueueListener = (state: QueueState) => void;

export interface SyncQueueOptions {
  store: OfflineStore;
  /** Performs the request. Throws to signal failure. */
  send: (mutation: QueuedMutation) => Promise<void>;
  /**
   * True when the error means "the network is gone", so the drain should pause
   * rather than march through the rest of the queue.
   */
  isTransportError?: (error: unknown) => boolean;
  /** True when retrying can never succeed (validation rejected the body). */
  isPermanentError?: (error: unknown) => boolean;
  now?: () => number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_BASE_DELAY_MS = 2_000;
export const DEFAULT_MAX_DELAY_MS = 5 * 60_000;

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Sync failed';
}

/** Full jitter is overkill for a single user's kitchen; plain doubling is fine. */
export function backoffDelay(attempts: number, base: number, cap: number): number {
  return Math.min(cap, base * 2 ** Math.max(0, attempts - 1));
}

export class SyncQueue {
  private readonly options: Required<
    Omit<SyncQueueOptions, 'store' | 'send' | 'isTransportError' | 'isPermanentError'>
  > &
    SyncQueueOptions;

  private listeners = new Set<QueueListener>();
  private draining: Promise<void> | null = null;
  private state: QueueState = {
    pending: 0,
    syncing: false,
    lastError: null,
    lastSyncedAt: null,
    dropped: 0,
  };
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onOnline = () => {
    void this.flush();
  };

  constructor(options: SyncQueueOptions) {
    this.options = {
      now: () => Date.now(),
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      baseDelayMs: DEFAULT_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
      ...options,
    };
  }

  private key(type: SyncResourceType, id: string): string {
    return `${QUEUE_PREFIX}${type}:${id}`;
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(patch: Partial<QueueState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  getState(): QueueState {
    return this.state;
  }

  async pending(): Promise<QueuedMutation[]> {
    const entries = await this.options.store.entries<QueuedMutation>(QUEUE_PREFIX);
    return entries
      .map(([, mutation]) => mutation)
      .sort((a, b) => (a.queued_at < b.queued_at ? -1 : a.queued_at > b.queued_at ? 1 : 0));
  }

  /**
   * Add or replace a mutation. Enqueuing the same `type:id` twice — a retry, or
   * the user rating a brew they logged 30 seconds ago — leaves exactly one
   * entry carrying the newest body.
   */
  async enqueue(
    input: Omit<QueuedMutation, 'queued_at' | 'attempts' | 'next_attempt_at'> &
      Partial<Pick<QueuedMutation, 'queued_at'>>,
  ): Promise<QueuedMutation> {
    const key = this.key(input.type, input.id);
    const existing = await this.options.store.get<QueuedMutation>(key);
    const now = this.options.now();

    const mutation: QueuedMutation = {
      ...input,
      queued_at: existing?.queued_at ?? input.queued_at ?? new Date(now).toISOString(),
      // A replacement body deserves a fresh run at the network.
      attempts: 0,
      next_attempt_at: now,
    };

    await this.options.store.set(key, mutation);
    this.emit({ pending: (await this.pending()).length });
    return mutation;
  }

  async remove(type: SyncResourceType, id: string): Promise<void> {
    await this.options.store.delete(this.key(type, id));
    this.emit({ pending: (await this.pending()).length });
  }

  /**
   * Replay everything due. Concurrent callers (a fresh log while the reconnect
   * drain is mid-flight) share one pass rather than racing the same entry.
   */
  flush(): Promise<void> {
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    const queued = await this.pending();
    if (queued.length === 0) {
      this.emit({ pending: 0, syncing: false });
      return;
    }

    this.emit({ syncing: true });
    let remaining = queued.length;
    let dropped = this.state.dropped;
    let lastError: string | null = null;

    for (const mutation of queued) {
      if (mutation.next_attempt_at > this.options.now()) continue;

      try {
        await this.options.send(mutation);
        await this.options.store.delete(this.key(mutation.type, mutation.id));
        remaining -= 1;
      } catch (error) {
        const attempts = mutation.attempts + 1;
        const permanent =
          this.options.isPermanentError?.(error) === true || attempts >= this.options.maxAttempts;
        lastError = messageOf(error);

        if (permanent) {
          // Recorded, not silently binned: the UI can offer "try again" and the
          // user's brew is still on the device either way.
          await this.options.store.delete(this.key(mutation.type, mutation.id));
          remaining -= 1;
          dropped += 1;
        } else {
          /**
           * Re-queue for another attempt — but ONLY if the entry is still
           * there.
           *
           * `send` is awaited, so anything may have happened meanwhile, and
           * `remove()` is a deliberate cancellation: deleting a brew drops its
           * pending upsert precisely so the drain cannot recreate it. Writing
           * this back unconditionally resurrected that entry and the deleted
           * brew reappeared on the next sync — the app visibly ignoring the
           * one instruction it had been given.
           */
          const key = this.key(mutation.type, mutation.id);
          if ((await this.options.store.get<QueuedMutation>(key)) === undefined) {
            remaining -= 1;
          } else {
            await this.options.store.set(key, {
              ...mutation,
              attempts,
              last_error: lastError,
              next_attempt_at:
                this.options.now() +
                backoffDelay(attempts, this.options.baseDelayMs, this.options.maxDelayMs),
            } satisfies QueuedMutation);
          }
        }

        if (this.options.isTransportError?.(error) === true) break;
      }
    }

    this.emit({
      pending: remaining,
      syncing: false,
      dropped,
      lastError,
      lastSyncedAt: lastError === null ? this.options.now() : this.state.lastSyncedAt,
    });

    if (remaining > 0) this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (!this.started || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.baseDelayMs);
  }

  /** Replay on reconnect, and once now in case we started up with a backlog. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    void this.flush();
  }

  stop(): void {
    this.started = false;
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
