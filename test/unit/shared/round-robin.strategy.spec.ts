import { describe, it, expect } from 'vitest';
import { RoundRobinStrategy } from '../../../src/shared/strategies/round-robin.strategy';

describe('RoundRobinStrategy', () => {
  describe('Constructor validation', () => {
    it('should throw an error if initialized with an empty array', () => {
      expect(() => new RoundRobinStrategy([])).toThrow(
        'RoundRobinStrategy requires at least one item.',
      );
    });
  });

  describe('Single item behavior', () => {
    it('should always return array with the single item on nextSequence()', () => {
      const strategy = new RoundRobinStrategy(['single']);
      expect(strategy.nextSequence()).toEqual(['single']);
      expect(strategy.nextSequence()).toEqual(['single']);
    });
  });

  describe('Multiple items cycling (nextSequence)', () => {
    it('should cycle through items using slice and advance circular cursor', () => {
      const strategy = new RoundRobinStrategy(['A', 'B', 'C']);

      expect(strategy.nextSequence()).toEqual(['A', 'B', 'C']);
      expect(strategy.nextSequence()).toEqual(['B', 'C', 'A']);
      expect(strategy.nextSequence()).toEqual(['C', 'A', 'B']);
      // Wrap around
      expect(strategy.nextSequence()).toEqual(['A', 'B', 'C']);
    });

    it('should work with complex provider objects as items', () => {
      const objA = { id: 1, name: 'provider-1' };
      const objB = { id: 2, name: 'provider-2' };
      const strategy = new RoundRobinStrategy([objA, objB]);

      expect(strategy.nextSequence()).toEqual([objA, objB]);
      expect(strategy.nextSequence()).toEqual([objB, objA]);
      expect(strategy.nextSequence()).toEqual([objA, objB]);
    });
  });
});
