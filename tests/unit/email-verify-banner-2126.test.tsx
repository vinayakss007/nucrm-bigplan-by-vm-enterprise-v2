// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2126 (item 4) — the banner side of the fix.
 *
 * `components/tenant/email-verify-banner.tsx` treated any HTTP 200 from
 * `/api/auth/resend-verification` as proof the mail was delivered, and said so
 * ("Verification email sent!"). The route now also answers `email_failed`, so
 * the banner has to read it: with no provider configured the user used to get a
 * success toast and an empty inbox, forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';
import EmailVerifyBanner from '@/components/tenant/email-verify-banner';

function respond(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('#2126 — the verify-email banner tells the truth about delivery', () => {
  it('says sent only when the route reports the mail actually went out', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ completed: false })) // onboarding status probe
      .mockResolvedValueOnce(respond({ ok: true, email_failed: false }));
    render(<EmailVerifyBanner email="rep@example.test" />);

    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Verification email sent!'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText('Sent!')).toBeTruthy();
  });

  it('a 200 with email_failed:true is shown as a failure, not as "Sent!"', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ completed: false }))
      .mockResolvedValueOnce(respond({ ok: true, email_failed: true }));
    render(<EmailVerifyBanner email="rep@example.test" />);

    fireEvent.click(screen.getByRole('button', { name: /resend email/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText('Sent!')).toBeNull();
    // The button stays, worded as what actually happened, so retry is possible.
    expect(screen.getByRole('button', { name: /not delivered/i })).toBeTruthy();
  });
});
