/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import {
  GENERIC_WORKSPACE_NAME,
  getInviteView,
  inviteErrorMessage,
  inviteJoinLabel,
  inviteWelcomeMessage,
  resolveWorkspaceName,
  type InviteDetailsLike,
} from '@/lib/auth/invite-view';

// Shape thrown by apiFetcher (lib/query/client.tsx) for non-2xx responses.
function apiQueryErrorLike(message: string, status: number, info: unknown) {
  const err = new Error(message) as Error & { name: string; status: number; info: unknown };
  err.name = 'ApiQueryError';
  err.status = status;
  err.info = info;
  return err;
}

const acme: InviteDetailsLike = {
  email: 'jane@example.com',
  tenant_name: 'Acme',
  primary_color: '#123456',
  role_slug: 'sales_rep',
};

describe('getInviteView (#2294)', () => {
  it('returns the invalid state when the token param is missing (never renders the form)', () => {
    const view = getInviteView({ token: null, loading: false, invitation: null, error: '' });
    expect(view.state).toBe('invalid');
    if (view.state === 'invalid') expect(view.message).toBe('Invalid invitation link');
  });

  it('returns the invalid state for a blank token', () => {
    const view = getInviteView({ token: '', loading: false, invitation: null, error: '' });
    expect(view.state).toBe('invalid');
  });

  it('shows loading while the invite-details lookup is in flight', () => {
    const view = getInviteView({ token: 'tok123', loading: true, invitation: null, error: '' });
    expect(view.state).toBe('loading');
  });

  it('surfaces the API error message as the invalid state for an invalid token', () => {
    const err = apiQueryErrorLike('Request failed (404)', 404, { error: 'Invitation not found or has expired' });
    const view = getInviteView({
      token: 'bad-token',
      loading: false,
      invitation: null,
      error: inviteErrorMessage(err),
    });
    expect(view.state).toBe('invalid');
    if (view.state === 'invalid') expect(view.message).toBe('Invitation not found or has expired');
  });

  it('falls back to the invalid state when no invitation resolved and no error set', () => {
    const view = getInviteView({ token: 'tok123', loading: false, invitation: null, error: '' });
    expect(view.state).toBe('invalid');
    if (view.state === 'invalid') expect(view.message).toBe('Invalid invitation link');
  });

  it('renders the form with the exact "Join Acme →" label for a valid invitation', () => {
    const view = getInviteView({ token: 'tok123', loading: false, invitation: acme, error: '' });
    expect(view.state).toBe('form');
    if (view.state === 'form') {
      expect(view.joinLabel).toBe('Join Acme →');
      expect(view.workspaceName).toBe('Acme');
      expect(view.avatarInitial).toBe('A');
      expect(view.invitation).toBe(acme);
    }
  });

  it('never contains the word "undefined" in any state output', () => {
    const inputs = [
      { token: null, loading: false, invitation: null, error: '' },
      { token: 'tok', loading: false, invitation: null, error: 'boom' },
      { token: 'tok', loading: false, invitation: { email: 'a@b.c' }, error: '' },
    ] as const;
    for (const input of inputs) {
      const view = getInviteView(input);
      const serialized = JSON.stringify(view);
      expect(serialized).not.toMatch(/undefined/i);
      if (view.state === 'form') expect(view.joinLabel).not.toMatch(/undefined/i);
    }
  });

  it('uses the generic workspace fallback when tenant_name is missing or blank', () => {
    const view = getInviteView({ token: 'tok', loading: false, invitation: { email: 'a@b.c' }, error: '' });
    expect(view.state).toBe('form');
    if (view.state === 'form') {
      expect(view.joinLabel).toBe(`Join ${GENERIC_WORKSPACE_NAME} →`);
      expect(view.workspaceName).toBe(GENERIC_WORKSPACE_NAME);
      expect(view.avatarInitial).toBe('T');
    }

    const blank = getInviteView({ token: 'tok', loading: false, invitation: { email: 'a@b.c', tenant_name: '   ' }, error: '' });
    if (blank.state === 'form') expect(blank.joinLabel).toBe(`Join ${GENERIC_WORKSPACE_NAME} →`);
  });
});

describe('label / message helpers (#2294)', () => {
  it('inviteJoinLabel matches the original happy-path copy for a named tenant', () => {
    expect(inviteJoinLabel(acme)).toBe('Join Acme →');
    expect(inviteJoinLabel(null)).toBe('Join the workspace →');
    expect(inviteJoinLabel(undefined)).toBe('Join the workspace →');
  });

  it('resolveWorkspaceName trims and falls back', () => {
    expect(resolveWorkspaceName({ email: 'a@b.c', tenant_name: '  Foo  ' })).toBe('Foo');
    expect(resolveWorkspaceName(null)).toBe(GENERIC_WORKSPACE_NAME);
  });

  it('inviteWelcomeMessage reproduces the original toast for a named tenant, generic otherwise', () => {
    expect(inviteWelcomeMessage(acme)).toBe('Welcome to Acme!');
    expect(inviteWelcomeMessage({ email: 'a@b.c' })).toBe('Welcome!');
  });

  it('inviteErrorMessage prefers the server body message, else the generic network copy', () => {
    expect(inviteErrorMessage(apiQueryErrorLike('Request failed (400)', 400, { error: 'Token required' }))).toBe('Token required');
    expect(inviteErrorMessage(apiQueryErrorLike('Request failed (500)', 500, {}))).toBe('Failed to load invitation');
    expect(inviteErrorMessage(new Error('network down'))).toBe('Failed to load invitation');
    expect(inviteErrorMessage(null)).toBe('Failed to load invitation');
  });
});
