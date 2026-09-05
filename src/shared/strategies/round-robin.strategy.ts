export class RoundRobinStrategy<T> {
  private index = 0;

  constructor(private readonly items: T[]) {
    if (items.length === 0) {
      throw new Error('RoundRobinStrategy requires at least one item.');
    }
  }

  nextSequence(): T[] {
    const sequence = [
      ...this.items.slice(this.index),
      ...this.items.slice(0, this.index),
    ];
    this.index = (this.index + 1) % this.items.length;
    return sequence;
  }
}
