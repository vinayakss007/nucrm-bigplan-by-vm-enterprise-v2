import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const cleanupRegistry: (() => void)[] = [];

vi.mock('react', () => ({
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (cleanup) cleanupRegistry.push(cleanup);
  },
  useRef: (initial?: unknown) => ({ current: initial ?? null }),
  useCallback: (fn: unknown) => fn,
}));

beforeEach(() => {
  cleanupRegistry.length = 0;
  vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
      setAttribute: vi.fn(),
      textContent: '',
      className: '',
    })),
    body: {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    activeElement: null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (...args: any[]) => any) => cb()));
});

afterEach(() => {
  let cb: (() => void) | undefined;
  while ((cb = cleanupRegistry.shift())) cb();
  vi.unstubAllGlobals();
});

describe('focusElement', () => {
  it('calls focus and sets tabindex on element', async () => {
    const { focusElement } = await import('@/lib/a11y');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const el = { focus: vi.fn(), setAttribute: vi.fn() } as any;
    focusElement(el);
    expect(el.focus).toHaveBeenCalledOnce();
    expect(el.setAttribute).toHaveBeenCalledWith('tabindex', '-1');
  });

  it('does nothing when element is null', async () => {
    const { focusElement } = await import('@/lib/a11y');
    expect(() => focusElement(null)).not.toThrow();
  });

  it('does nothing when element is undefined', async () => {
    const { focusElement } = await import('@/lib/a11y');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => focusElement(undefined as any)).not.toThrow();
  });
});

describe('useFocusTrap', () => {
  it('does nothing when disabled', async () => {
    const addEventListener = vi.fn();
    const { useFocusTrap } = await import('@/lib/a11y');
    useFocusTrap({ current: { addEventListener, querySelectorAll: vi.fn() } }, false);
    expect(addEventListener).not.toHaveBeenCalled();
  });

  it('does nothing when ref is null', async () => {
    const { useFocusTrap } = await import('@/lib/a11y');
    expect(() => useFocusTrap({ current: null }, true)).not.toThrow();
  });
});

describe('useFocusRestore', () => {
  it('returns a function', async () => {
    const { useFocusRestore } = await import('@/lib/a11y');
    const restore = useFocusRestore({ current: null });
    expect(typeof restore).toBe('function');
  });
});

describe('useId', () => {
  it('returns a prefixed unique id', async () => {
    const { useId } = await import('@/lib/a11y');
    const id1 = useId('test');
    expect(id1).toMatch(/^test-\d+$/);
  });

  it('uses default prefix', async () => {
    const { useId } = await import('@/lib/a11y');
    const id = useId();
    expect(id).toMatch(/^a11y-\d+$/);
  });

  it('generates sequential unique ids', async () => {
    const { useId } = await import('@/lib/a11y');
    const id1 = useId('seq');
    const id2 = useId('seq');
    expect(id1).toMatch(/^seq-\d+$/);
    expect(id2).toMatch(/^seq-\d+$/);
  });
});

describe('useAnnounce', () => {
  it('returns an announce function', async () => {
    const { useAnnounce } = await import('@/lib/a11y');
    const announce = useAnnounce();
    expect(typeof announce).toBe('function');
  });
});

describe('useEscapeKey', () => {
  it('registers keydown listener when enabled', async () => {
    const { useEscapeKey } = await import('@/lib/a11y');
    useEscapeKey(() => {}, true);
    expect(document.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('does not register when disabled', async () => {
    const { useEscapeKey } = await import('@/lib/a11y');
    useEscapeKey(() => {}, false);
    expect(document.addEventListener).not.toHaveBeenCalled();
  });
});
