import { TestBed } from '@angular/core/testing';
import { STREAM_CHUNK_SIZE, StreamStore, gzipJson } from './stream-store';

describe('StreamStore', () => {
  let store: StreamStore;
  const sid = () => `spec-${Math.random().toString(36).slice(2)}`;

  beforeEach(() => {
    store = TestBed.inject(StreamStore);
  });

  it('appends across a chunk boundary and reads the events back in order', async () => {
    const id = sid();
    const n = STREAM_CHUNK_SIZE + 7;
    for (let i = 0; i < n; i++) store.append(id, 'clicks', { i });
    const events = (await store.read(id, 'clicks')) as { i: number }[];
    expect(events.length).toBe(n);
    expect(events[0].i).toBe(0);
    expect(events[n - 1].i).toBe(n - 1);
    expect(await store.read(id, 'calls')).toEqual([]);
    await store.delete(id);
  });

  it("deletes a session's streams", async () => {
    const id = sid();
    store.append(id, 'states', { s: 1 });
    await store.flush();
    await store.delete(id);
    expect(await store.read(id, 'states')).toEqual([]);
  });

  it('leaves empty streams out of readAll', async () => {
    const id = sid();
    store.append(id, 'calls', { c: 1 });
    expect(Object.keys(await store.readAll(id))).toEqual(['calls']);
    await store.delete(id);
  });

  it('sets failed instead of throwing when IndexedDB is unavailable', async () => {
    spyOn(indexedDB, 'open').and.throwError('blocked');
    const fresh = new StreamStore();
    fresh.append('x', 'clicks', { c: 1 });
    await fresh.flush();
    expect(fresh.failed()).toBeTrue();
  });

  it('gzips JSON that DecompressionStream reads back', async () => {
    const value = { a: [1, 2, 3], b: 'ü' };
    const { blob, gzipped } = await gzipJson(value);
    expect(gzipped).toBeTrue();
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    expect(JSON.parse(text)).toEqual(value);
  });
});
