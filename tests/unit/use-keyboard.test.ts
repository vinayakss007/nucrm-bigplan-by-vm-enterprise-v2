import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listeners = new Map<string, Set<(...args: any[]) => void>>();

beforeEach(() => {
  listeners.clear();
  vi.clearAllMocks();
  vi.stubGlobal('window', {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    removeEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentTarget: any = null;
  vi.stubGlobal('KeyboardEvent', class {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    preventDefault: ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(type: string, init?: any) {
      this.key = init?.key ?? '';
      this.metaKey = init?.metaKey ?? false;
      this.ctrlKey = init?.ctrlKey ?? false;
      this.preventDefault = vi.fn();
      this.target = currentTarget;
    }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    static setCurrentTarget(el: any) { currentTarget = el; }
  });
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elListeners = new Map<string, Set<(...args: any[]) => void>>();
      const dataAttrs: Record<string, string> = {};
      const self = {
        tagName: tag.toUpperCase(),
        setAttribute: vi.fn((attr: string, val: string) => {
          if (attr.startsWith('data-')) {
            const camel = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            dataAttrs[camel] = val;
          }
        }),
        get dataset() { return dataAttrs; },
        parentElement: null,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        appendChild: vi.fn((child: any) => { child.parentElement = self; }),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        dispatchEvent: vi.fn((event: any) => {
          elListeners.get('keydown')?.forEach(h => h(event));
          if (self.parentElement) self.parentElement.dispatchEvent(event);
        }),
        focus: vi.fn(),
        click: vi.fn(),
        querySelector: vi.fn(),
// eslint-disable-next-line @typescript-eslint/no-explicit-any
        addEventListener: vi.fn((event: string, handler: (...args: any[]) => void) => {
          if (!elListeners.has(event)) elListeners.set(event, new Set());
          elListeners.get(event)!.add(handler);
        }),
        removeEventListener: vi.fn(),
      };
      return self;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

vi.mock('react', () => ({
  useEffect: (fn: () => void | (() => void)) => {
    const cleanup = fn();
    if (cleanup) {
      const event = 'cleanup';
      if (!listeners.has(event)) listeners.set(event, new Set());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
      listeners.get(event)!.add(cleanup as any);
    }
  },
  useRef: (initial?: unknown) => ({ current: initial ?? null }),
  useCallback: (fn: unknown) => fn,
}));

function triggerKey(key: string, metaKey = false, ctrlKey = false) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { KeyboardEvent: KE } = globalThis as any;
  const event = new KE('keydown', { key, metaKey, ctrlKey });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  listeners.get('keydown')?.forEach((h: any) => h(event));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function triggerKeyOnElement(el: any, key: string) {
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { KeyboardEvent: KE } = globalThis as any;
  KE.setCurrentTarget(el);
  const event = new KE('keydown', { key });
  KE.setCurrentTarget(null);
  el.dispatchEvent(event);
}

describe('useCmdSSave', () => {
  it('calls handler on Cmd+S', async () => {
    const { useCmdSSave } = await import('@/lib/use-keyboard');
    const handler = vi.fn();
    useCmdSSave(handler);
    triggerKey('s', true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls handler on Ctrl+S', async () => {
    const { useCmdSSave } = await import('@/lib/use-keyboard');
    const handler = vi.fn();
    useCmdSSave(handler);
    triggerKey('s', false, true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call handler on other keys', async () => {
    const { useCmdSSave } = await import('@/lib/use-keyboard');
    const handler = vi.fn();
    useCmdSSave(handler);
    triggerKey('a', true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('removes event listener on cleanup', async () => {
    const { useCmdSSave } = await import('@/lib/use-keyboard');
    const handler = vi.fn();
    useCmdSSave(handler);
    const sizeBefore = listeners.get('keydown')?.size ?? 0;
    listeners.get('cleanup')?.forEach(c => c());
    const sizeAfter = listeners.get('keydown')?.size ?? 0;
    expect(sizeAfter).toBeLessThanOrEqual(sizeBefore - 1);
  });
});

describe('useEscape', () => {
  it('calls handler on Escape key', async () => {
    const { useEscape } = await import('@/lib/use-keyboard');
    const handler = vi.fn();
    useEscape(handler);
    triggerKey('Escape');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call handler on other keys', async () => {
    const { useEscape } = await import('@/lib/use-keyboard');
    const handler = vi.fn();
    useEscape(handler);
    triggerKey('Enter');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('useArrowNav', () => {
  it('does nothing when container ref is null', async () => {
    const { useArrowNav } = await import('@/lib/use-keyboard');
    expect(() => useArrowNav({ current: null }, 5, vi.fn())).not.toThrow();
  });

  it('ignores events from input elements', async () => {
    const { useArrowNav } = await import('@/lib/use-keyboard');
    const el = document.createElement('div');
    const handler = vi.fn();
    useArrowNav({ current: el }, 5, handler);
    const input = document.createElement('input');
    el.appendChild(input);
    triggerKeyOnElement(input, 'ArrowDown');
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles ArrowDown navigation from unfocused state', async () => {
    const { useArrowNav } = await import('@/lib/use-keyboard');
    const el = document.createElement('div');
    const handler = vi.fn();
    useArrowNav({ current: el }, 5, handler);
    triggerKeyOnElement(el, 'ArrowDown');
    expect(handler).toHaveBeenCalledWith(0);
  });

  it('handles ArrowUp navigation from unfocused state', async () => {
    const { useArrowNav } = await import('@/lib/use-keyboard');
    const el = document.createElement('div');
    const handler = vi.fn();
    useArrowNav({ current: el }, 5, handler);
    triggerKeyOnElement(el, 'ArrowUp');
    expect(handler).toHaveBeenCalledWith(0);
  });

  it('handles Enter on a focused row with data-row-index', async () => {
    const { useArrowNav } = await import('@/lib/use-keyboard');
    const el = document.createElement('div');
    const row = document.createElement('div');
    row.setAttribute('data-row-index', '2');
    el.appendChild(row);
    el.querySelector = vi.fn((sel: string) => {
      if (sel === '[data-row-index]') return row;
      return null;
    });
    const handler = vi.fn();
    useArrowNav({ current: el }, 5, handler);
    triggerKeyOnElement(el, 'Enter');
    expect(handler).toHaveBeenCalledWith(2);
  });
});
