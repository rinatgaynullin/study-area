import { describe, expect, it } from 'vitest';
import { LruCache } from '../src/utils/lru-cache';

describe('LruCache', () => {
  it('вытесняет самую давнюю запись при переполнении', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);

    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('чтение делает запись свежей', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // «a» прочитали — теперь давняя запись «b».
    cache.get('a');
    cache.set('c', 3);

    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
  });

  it('перезапись не раздувает кэш', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('a', 2);
    cache.set('b', 3);

    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(2);
  });
});
