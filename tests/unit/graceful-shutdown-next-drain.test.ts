import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * PP-029. `instrumentation.ts` registered the shutdown handlers with the
 * defaults, so on SIGTERM this module waited on its own in-flight counter,
 * called `pool.end()` and then `process.exit(0)`. Next.js registers a handler
 * for the same signal (next/dist/server/lib/start-server.js:389) whose cleanup
 * awaits `server.close()` — the only thing that can see every open connection,
 * Server Component renders and streamed responses included — and then exits
 * 143 (:370). Both listeners run for one signal, so ours pre-empted a strictly
 * better-informed drain and cut live requests off mid-statement.
 *
 * Measured on preprod, which is what retracted the register's "~2 s" estimate:
 * the stop took 35.93 s and exited 0, because `pool.end()` has no timeout of its
 * own — pg-pool waits for every *checked-out* client — and two connections had
 * leaked. So the two properties asserted here are independent belts:
 *  * `exitProcess: false` — Next.js owns the exit.
 *  * `endPool: false` — the pool is left open; ending it can never make a
 *    running query finish, only guarantee that its next checkout fails.
 * The `inFlightCount` guard on the default path is the third: even a process
 * that owns its lifecycle should not close a pool that is still in use.
 */

const { end, flush } = vi.hoisted(() => ({
  end: vi.fn(async () => {}),
  flush: vi.fn(async () => true),
}));

vi.mock('@sentry/nextjs', () => ({ flush }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ end }) }));

async function fresh() {
  vi.resetModules();
  return await import('../../lib/db/graceful-shutdown');
}

let warn: ReturnType<typeof vi.spyOn>;
let exit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  end.mockClear();
  flush.mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // A real process.exit here would kill the test worker, which is exactly the
  // failure mode being asserted against — stub it and check whether it is hit.
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
});

afterEach(() => {
  warn.mockRestore();
  exit.mockRestore();
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
});

describe('pool.end() is skipped while work is still in flight', () => {
  it('leaves the pool open when the drain times out', async () => {
    const mod = await fresh();
    mod.resetShutdownState();
    mod.trackRequestStart(); // and never finishes, as an unwrapped cron job would

    await mod.initiateShutdown({ drainTimeoutMs: 50 });

    expect(end).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('Skipped pool.end()');
  });

  it('still drains the pool once the work finishes inside the window', async () => {
    const mod = await fresh();
    mod.resetShutdownState();
    mod.trackRequestStart();
    setTimeout(() => mod.trackRequestEnd(), 20);

    await mod.initiateShutdown({ drainTimeoutMs: 2_000 });

    expect(end).toHaveBeenCalledTimes(1);
  });

  it('drains normally with nothing in flight (no regression for a quiet redeploy)', async () => {
    const mod = await fresh();
    mod.resetShutdownState();

    await mod.initiateShutdown({ drainTimeoutMs: 50 });

    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('endPool: false hands the pool to the process that owns it', () => {
  it('never calls pool.end(), even with work counted in flight', async () => {
    const mod = await fresh();
    mod.resetShutdownState();
    mod.trackRequestStart();

    await mod.initiateShutdown({ endPool: false, drainTimeoutMs: 5_000 });

    expect(end).not.toHaveBeenCalled();
    mod.trackRequestEnd();
  });

  it('does not wait on its own counter either — that wait is Next.js\'s job', async () => {
    // The counter is module state, and whether the Next server bundle shares the
    // same copy as the one `withApiRoute` increments is a bundling detail this
    // module cannot see. So the value is logged, not acted on: waiting on it
    // would add stop-time without adding safety.
    const mod = await fresh();
    mod.resetShutdownState();
    mod.trackRequestStart();
    const startedAt = Date.now();

    await mod.initiateShutdown({ endPool: false, drainTimeoutMs: 5_000 });
    const elapsed = Date.now() - startedAt;

    mod.trackRequestEnd();
    expect(elapsed).toBeLessThan(1_000);
  });

  it('still flushes Sentry, because buffered events die with the process', async () => {
    const mod = await fresh();
    mod.resetShutdownState();

    await mod.initiateShutdown({ endPool: false });

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('the default path is unchanged: a process that owns its exit still closes the pool', async () => {
    const mod = await fresh();
    mod.resetShutdownState();

    await mod.initiateShutdown({ drainTimeoutMs: 20 });

    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('the signal handler no longer owns the exit', () => {
  it('exitProcess: false (what instrumentation.ts now passes) never calls process.exit', async () => {
    const mod = await fresh();
    mod.resetShutdownState();
    mod.registerShutdownHandlers({ exitProcess: false, endPool: false, drainTimeoutMs: 20 });

    process.emit('SIGTERM');
    await new Promise((res) => setTimeout(res, 120));

    expect(exit).not.toHaveBeenCalled();
    // Both hand-backs are in force together: no exit, and no pool close either.
    expect(end).not.toHaveBeenCalled();
  });

  it('the default still exits 0, for callers that own their lifecycle', async () => {
    const mod = await fresh();
    mod.resetShutdownState();
    mod.registerShutdownHandlers({ drainTimeoutMs: 20 });

    process.emit('SIGTERM');
    await new Promise((res) => setTimeout(res, 120));

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('instrumentation.ts actually passes both hand-back flags', async () => {
    // The module defaults are deliberately still `true`, so the whole fix lives in
    // two call-site flags. Read as behaviour, nothing here would notice either one
    // being dropped, and the next `next start` refactor would silently restore the
    // bug. So assert the call site — and assert it on the argument object only,
    // because the prose comment above it mentions both flags by name and a
    // whole-file substring match passes even with the flags flipped to `true`
    // (that mutation was run, and it passed, before this was narrowed).
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../../instrumentation.ts', import.meta.url), 'utf8');
    const call = src.match(/registerShutdownHandlers\(\{[\s\S]*?\n\s*\}\);/)?.[0];
    expect(call, 'registerShutdownHandlers({...}) call site').toBeDefined();
    expect(call).toMatch(/exitProcess:\s*false/);
    expect(call).toMatch(/endPool:\s*false/);
    // The drain wait must be gone too: a stale `drainTimeoutMs` here would read as
    // still-configured while `endPool: false` means the loop never runs.
    expect(call).not.toMatch(/drainTimeoutMs/);
  });
});
