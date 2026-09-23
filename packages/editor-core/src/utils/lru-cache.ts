/**
 * Кэш с потолком и вытеснением самой давней записи.
 *
 * Обращение к записи делает её свежей: то, что читают постоянно — превью
 * шаблонов галереи, формулы открытого документа, — переживает поток
 * одноразовых записей вроде каждого промежуточного LaTeX при наборе.
 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);

    if (value === undefined) return undefined;

    // Map хранит порядок вставки: перевставка делает запись самой свежей.
    this.entries.delete(key);
    this.entries.set(key, value);

    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);

    if (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next();

      if (!oldest.done) this.entries.delete(oldest.value);
    }

    this.entries.set(key, value);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
