import { Injectable, signal } from '@angular/core';

/** The high-volume streams of a session (docs/plans/experiment-logging-frontend-and-replay.md §4.1). */
export type StreamName = 'calls' | 'clicks' | 'states';
export const STREAM_NAMES: readonly StreamName[] = ['calls', 'clicks', 'states'];

export const STREAM_DB = 'flatland_study_streams';
export const STREAM_CHUNK_SIZE = 500;
/** Written through at the latest this often, so a crash loses at most about a second. */
export const STREAM_FLUSH_MS = 1000;

const STORE = 'chunks';

interface Chunk {
  sid: string;
  stream: StreamName;
  n: number;
  events: unknown[];
}

interface Buffer {
  n: number;
  events: unknown[];
  dirty: boolean;
}

/**
 * Append-only event streams in IndexedDB, next to the session record in
 * `localStorage` (plan §4.1, pattern P1).
 *
 * Events go into chunks of `STREAM_CHUNK_SIZE`; an append only touches the
 * open chunk in memory, and dirty chunks are written through every
 * `STREAM_FLUSH_MS` and on `pagehide`. Failures (private window, quota, no
 * IndexedDB) never reach the UI: they set `failed`, and the footer says so.
 *
 * Whether a stream is written at all ("Study logging", replay) is decided by
 * the caller, `InteractionLogService.appendStream`.
 */
@Injectable({ providedIn: 'root' })
export class StreamStore {
  /** Writing to IndexedDB failed at least once; the streams may be incomplete. */
  readonly failed = signal(false);

  private _db: Promise<IDBDatabase | null> | null = null;
  private readonly _buffers = new Map<string, Buffer>();
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;
  private _persistAsked = false;

  constructor() {
    if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void this.flush());
  }

  append(sid: string, stream: StreamName, event: unknown): void {
    const key = bufferKey(sid, stream);
    let buffer = this._buffers.get(key);
    if (!buffer) {
      buffer = { n: 0, events: [], dirty: false };
      this._buffers.set(key, buffer);
      void this._resumeChunk(sid, stream, buffer);
    }
    if (buffer.events.length >= STREAM_CHUNK_SIZE) {
      // The full chunk is written as it stands; the next event opens a new one.
      void this._put({ sid, stream, n: buffer.n, events: buffer.events });
      buffer.n += 1;
      buffer.events = [];
    }
    buffer.events.push(event);
    buffer.dirty = true;
    this._scheduleFlush();
  }

  /** Every event of one stream, in order. */
  async read(sid: string, stream: StreamName): Promise<unknown[]> {
    await this.flush();
    const db = await this._open();
    if (!db) return this._buffers.get(bufferKey(sid, stream))?.events.slice() ?? [];
    try {
      const chunks = await request<Chunk[]>(
        db.transaction(STORE, 'readonly').objectStore(STORE).getAll(range(sid, stream)),
      );
      return chunks.sort((a, b) => a.n - b.n).flatMap((c) => c.events);
    } catch {
      this.failed.set(true);
      return [];
    }
  }

  /** All three streams of a session, for an export. Empty streams are left out. */
  async readAll(sid: string): Promise<Partial<Record<StreamName, unknown[]>>> {
    const out: Partial<Record<StreamName, unknown[]>> = {};
    for (const stream of STREAM_NAMES) {
      const events = await this.read(sid, stream);
      if (events.length) out[stream] = events;
    }
    return out;
  }

  async delete(sid: string): Promise<void> {
    for (const stream of STREAM_NAMES) this._buffers.delete(bufferKey(sid, stream));
    const db = await this._open();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      for (const stream of STREAM_NAMES) tx.objectStore(STORE).delete(range(sid, stream));
      await done(tx);
    } catch {
      this.failed.set(true);
    }
  }

  /** Write every dirty chunk now. */
  async flush(): Promise<void> {
    if (this._flushTimer != null) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    const writes: Promise<void>[] = [];
    performance.mark('flatland:stream-flush:start');
    for (const [key, buffer] of this._buffers) {
      if (!buffer.dirty) continue;
      buffer.dirty = false;
      const [sid, stream] = splitKey(key);
      writes.push(this._put({ sid, stream, n: buffer.n, events: buffer.events.slice() }));
    }
    await Promise.all(writes);
    measure('flatland:stream-flush', 'flatland:stream-flush:start');
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _scheduleFlush(): void {
    if (this._flushTimer != null) return;
    this._flushTimer = setTimeout(() => void this.flush(), STREAM_FLUSH_MS);
  }

  /** After a reload the stream continues in a new chunk after the last stored one. */
  private async _resumeChunk(sid: string, stream: StreamName, buffer: Buffer): Promise<void> {
    const db = await this._open();
    if (!db) return;
    try {
      const keys = await request<IDBValidKey[]>(
        db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys(range(sid, stream)),
      );
      if (!keys.length) return;
      const last = Math.max(...keys.map((k) => Number((k as unknown[])[2])));
      // Events appended while this lookup ran move to the new chunk.
      buffer.n = Math.max(buffer.n, last + 1);
      buffer.dirty = buffer.events.length > 0;
    } catch {
      this.failed.set(true);
    }
  }

  private async _put(chunk: Chunk): Promise<void> {
    const db = await this._open();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(chunk);
      await done(tx);
    } catch {
      this.failed.set(true);
    }
  }

  private _open(): Promise<IDBDatabase | null> {
    if (this._db) return this._db;
    this._db = new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
        const req = indexedDB.open(STREAM_DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: ['sid', 'stream', 'n'] });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => {
          this.failed.set(true);
          resolve(null);
        };
      } catch {
        this.failed.set(true);
        resolve(null);
      }
    });
    this._askPersist();
    return this._db;
  }

  /** Ask once that the browser does not evict the streams under storage pressure. */
  private _askPersist(): void {
    if (this._persistAsked) return;
    this._persistAsked = true;
    try {
      void navigator.storage?.persist?.().catch(() => undefined);
    } catch {
      // Not offered by this browser.
    }
  }
}

/** One JSON value as a gzip blob, with the native `CompressionStream`; plain JSON where it is missing. */
export async function gzipJson(value: unknown): Promise<{ blob: Blob; gzipped: boolean }> {
  const json = new Blob([JSON.stringify(value)], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') return { blob: json, gzipped: false };
  const stream = json.stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob().then((b) => new Blob([b], { type: 'application/gzip' })), gzipped: true };
}

/** `performance.measure` between a start mark and now; read by the measurement run (plan §10.1). */
export function measure(name: string, startMark: string): void {
  try {
    performance.measure(name, startMark);
  } catch {
    // The mark is missing or the API is unavailable.
  }
}

function bufferKey(sid: string, stream: StreamName): string {
  return `${sid}\u0000${stream}`;
}

function splitKey(key: string): [string, StreamName] {
  const [sid, stream] = key.split('\u0000');
  return [sid, stream as StreamName];
}

function range(sid: string, stream: StreamName): IDBKeyRange {
  return IDBKeyRange.bound([sid, stream, 0], [sid, stream, Number.MAX_SAFE_INTEGER]);
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
