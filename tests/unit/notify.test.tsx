import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock react-hot-toast
const mockToast = vi.fn(() => 'toast-id');
const mockDismiss = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: Object.assign(mockToast, { dismiss: mockDismiss }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  CheckCircle: () => null,
  XCircle: () => null,
  AlertTriangle: () => null,
  Info: () => null,
  X: () => null,
}));

describe('notify utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifySuccess calls toast with success message', async () => {
    const { notifySuccess } = await import('@/lib/notify');
    notifySuccess('Test success');
    expect(mockToast).toHaveBeenCalledOnce();
    const callArgs = mockToast.mock.calls[0];
    expect(callArgs[1]).toMatchObject({ duration: 4000 });
  });

  it('notifyError calls toast with error message', async () => {
    const { notifyError } = await import('@/lib/notify');
    notifyError('Test error');
    expect(mockToast).toHaveBeenCalledOnce();
  });

  it('notifyWarning calls toast with warning message', async () => {
    const { notifyWarning } = await import('@/lib/notify');
    notifyWarning('Test warning');
    expect(mockToast).toHaveBeenCalledOnce();
  });

  it('notifyInfo calls toast with info message', async () => {
    const { notifyInfo } = await import('@/lib/notify');
    notifyInfo('Test info');
    expect(mockToast).toHaveBeenCalledOnce();
  });
});
