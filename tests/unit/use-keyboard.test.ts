import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #1269: the fake-DOM harness below was `any`-typed; the shapes it actually
// needs are small enough to state outright, so the suppressions are gone.
type EventHandler = (...args: unknown[]) => void;

interface FakeKeyboardEventInit {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

interface FakeKeyboardEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  preventDefault(): void;
  target: FakeElement | null;
}

interface FakeKeyboardEventCtor {
  new (type: string, init?: FakeKeyboardEventInit): FakeKeyboardEvent;
  setCurrentTarget(el: FakeElement | null): void;
}

interface FakeElement {
  tagName: string;
  setAttribute(attr: string, val: string): void;
  readonly dataset: Record<string, string>;
  parentElement: FakeElement | null;
  appendChild(child: FakeElement): void;
  dispatchEvent(event: FakeKeyboardEvent): void;
  focus(): void;
  click(): void;
  querySelector(sel: string): FakeElement | null;
  addEventListener(event: string, handler: EventHandler): void;
  removeEventListener(): void;
}

const listeners = new Map<string, Set<EventHandler>>();

beforeEach(() => {
  listeners.clear();
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    addEventListener: vi.fn((event: string, handler: EventHandler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    removeEventListener: vi.fn((event: string, handler: EventHandler) => {
      listeners.get(event)?.delete(handler);
    }),
  });
  let currentTarget: FakeElement | null = null;
  vi.stubGlobal('KeyboardEvent', class implements FakeKeyboardEvent {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    preventDefault: ReturnType<typeof vi.fn>;
    target: FakeElement | null;
    constructor(type: string, init?: FakeKeyboardEventInit) {
      this.key = init?.key ?? '';
      this.metaKey = init?.metaKey ?? false;
      this.ctrlKey = init?.ctrlKey ?? false;
      this.preventDefault = vi.fn();
      this.target = currentTarget;
    }
    static setCurrentTarget(el: FakeElement | null) { currentTarget = el; }
  });
  vi.stubGlobal('document', {
    createElement: (tag: string): FakeElement => {
      const elListeners = new Map<string, Set<EventHandler>>();
      const dataAttrs: Record<string, string> = {};
      const self: FakeElement = {
        tagName: tag.toUpperCase(),
        setAttribute: vi.fn((attr: string, val: string) => {
          if (attr.startsWith('data-')) {
            const camel = attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            dataAttrs[camel] = val;
          }
        }),
        get dataset() { return dataAttrs; },
        parentElement: null,
        appendChild: vi.fn((child: FakeElement) => { child.parentElement = self; }),
        dispatchEvent: vi.fn((event: FakeKeyboardEvent) => {
          elListeners.get('keydown')?.forEach(h => h(event));
          if (self.parentElement) self.parentElement.dispatchEvent(event);
        }),
        focus: vi.fn(),
        click: vi.fn(),
        querySelector: vi.fn(),
        addEventListener: vi.fn((event: string, handler: EventHandler) => {
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
      listeners.get(event)!.add(cleanup);
    }
  },
  useRef: (initial?: unknown) => ({ current: initial ?? null }),
  useCallback: (fn: unknown) => fn,
}));

function triggerKey(key: string, metaKey = false, ctrlKey = false) {
  const KE: FakeKeyboardEventCtor = (globalThis as unknown as { KeyboardEvent: FakeKeyboardEventCtor }).KeyboardEvent;
  const event = new KE('keydown', { key, metaKey, ctrlKey });
  listeners.get('keydown')?.forEach(h => h(event));
}

function triggerKeyOnElement(el: FakeElement, key: string) {
  const KE: FakeKeyboardEventCtor = (globalThis as unknown as { KeyboardEvent: FakeKeyboardEventCtor }).KeyboardEvent;
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
