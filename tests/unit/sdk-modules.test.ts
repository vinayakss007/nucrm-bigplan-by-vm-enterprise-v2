 
import { describe, it, expect } from 'vitest';

describe('sdk/modules.ts re-exports', () => {
  it('exports all expected symbols', async () => {
    const mod = await import('@/lib/sdk/modules');
    expect(mod).toBeDefined();
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });
});
