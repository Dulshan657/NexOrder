import { it, expect } from 'vitest';

// probe: proves a red PR cannot merge into main. Never merged; branch deleted.
it('is deliberately red', () => {
  expect(1).toBe(2);
});
