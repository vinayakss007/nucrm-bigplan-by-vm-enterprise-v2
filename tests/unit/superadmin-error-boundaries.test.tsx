// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseCaptureError = vi.fn();
vi.mock('@/lib/capture-error', () => ({
  useCaptureError: (...args: unknown[]) => mockUseCaptureError(...args),
}));

import AuditError from '@/app/superadmin/audit/error';
import DunningError from '@/app/superadmin/billing/dunning/error';
import UserDetailError from '@/app/superadmin/users/[id]/error';

describe('superadmin error boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AuditError', () => {
    it('renders the audit-specific heading and message', () => {
      render(<AuditError error={new Error('boom')} reset={vi.fn()} />);
      expect(screen.getByText('Audit Log Error')).toBeTruthy();
      expect(screen.getByText('Failed to load audit log data.')).toBeTruthy();
    });

    it('reports the error with the superadmin-audit context', () => {
      const error = new Error('audit failure');
      render(<AuditError error={error} reset={vi.fn()} />);
      expect(mockUseCaptureError).toHaveBeenCalledWith(error, 'superadmin-audit');
    });

    it('calls reset when "Try again" is clicked', () => {
      const reset = vi.fn();
      render(<AuditError error={new Error('boom')} reset={reset} />);
      fireEvent.click(screen.getByText('Try again'));
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('DunningError', () => {
    it('renders the dunning-specific heading and message', () => {
      render(<DunningError error={new Error('boom')} reset={vi.fn()} />);
      expect(screen.getByText('Dunning Error')).toBeTruthy();
      expect(screen.getByText('Failed to load dunning data.')).toBeTruthy();
    });

    it('reports the error with the superadmin-billing-dunning context', () => {
      const error = new Error('dunning failure');
      render(<DunningError error={error} reset={vi.fn()} />);
      expect(mockUseCaptureError).toHaveBeenCalledWith(error, 'superadmin-billing-dunning');
    });

    it('calls reset when "Try again" is clicked', () => {
      const reset = vi.fn();
      render(<DunningError error={new Error('boom')} reset={reset} />);
      fireEvent.click(screen.getByText('Try again'));
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('UserDetailError', () => {
    it('renders the user-detail-specific heading and message', () => {
      render(<UserDetailError error={new Error('boom')} reset={vi.fn()} />);
      expect(screen.getByText('User Error')).toBeTruthy();
      expect(screen.getByText('Failed to load user details.')).toBeTruthy();
    });

    it('reports the error with the superadmin-user-detail context', () => {
      const error = new Error('user detail failure');
      render(<UserDetailError error={error} reset={vi.fn()} />);
      expect(mockUseCaptureError).toHaveBeenCalledWith(error, 'superadmin-user-detail');
    });

    it('calls reset when "Try again" is clicked', () => {
      const reset = vi.fn();
      render(<UserDetailError error={new Error('boom')} reset={reset} />);
      fireEvent.click(screen.getByText('Try again'));
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });

  it('renders distinct copy across the three boundaries (no accidental duplication)', () => {
    const headings = new Set<string>();
    [AuditError, DunningError, UserDetailError].forEach((Component) => {
      const { unmount } = render(<Component error={new Error('x')} reset={vi.fn()} />);
      const heading = screen.getByRole('heading', { level: 2 }).textContent;
      if (heading) headings.add(heading);
      unmount();
    });
    expect(headings.size).toBe(3);
  });
});