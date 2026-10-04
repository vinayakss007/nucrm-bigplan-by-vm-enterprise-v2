/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Pure view-state helpers for `/auth/invite` (#2294).
 *
 * The page previously interpolated `invitation?.tenant_name` directly into the
 * submit-button label, so a missing/invalid `?token=` (or the SSR pass before
 * the invite-details query resolved) rendered the literal text
 * "Join undefined →" together with a dead join form. These helpers compute the
 * same state synchronously — with a generic workspace-name fallback — so the
 * page can gate rendering without any effect-timing races.
 */

export interface InviteDetailsLike {
  email: string;
  tenant_name?: string;
  primary_color?: string;
  role_slug?: string;
}

/** Shown when the tenant/workspace name is unknown (never renders "undefined"). */
export const GENERIC_WORKSPACE_NAME = 'the workspace';

/** Trimmed tenant name, or the generic fallback when absent/blank. */
export function resolveWorkspaceName(invitation?: InviteDetailsLike | null): string {
  const name = invitation?.tenant_name?.trim();
  return name || GENERIC_WORKSPACE_NAME;
}

/** Submit-button label for a given invitation, e.g. "Join Acme →". */
export function inviteJoinLabel(invitation?: InviteDetailsLike | null): string {
  return `Join ${resolveWorkspaceName(invitation)} →`;
}

/** Post-accept toast, e.g. "Welcome to Acme!" or a generic welcome. */
export function inviteWelcomeMessage(invitation?: InviteDetailsLike | null): string {
  const name = invitation?.tenant_name?.trim();
  return name ? `Welcome to ${name}!` : 'Welcome!';
}

/**
 * Human-readable message for a failed invite-details lookup. Non-2xx responses
 * throw `ApiQueryError` (see `lib/query/client.tsx`) carrying the parsed body
 * in `.info`, so the server's own 400/404 message ("Invitation not found or
 * has expired") is surfaced as the invalid state; anything else falls back to
 * the original generic network-failure copy.
 */
export function inviteErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'info' in err) {
    const info = (err as { info: unknown }).info;
    if (info && typeof info === 'object' && 'error' in info) {
      const message = (info as { error: unknown }).error;
      if (typeof message === 'string' && message.trim().length > 0) return message.trim();
    }
  }
  return 'Failed to load invitation';
}

export type InviteView =
  | { state: 'loading' }
  | { state: 'invalid'; message: string }
  | {
      state: 'form';
      invitation: InviteDetailsLike;
      joinLabel: string;
      workspaceName: string;
      avatarInitial: string;
    };

/**
 * Single source of truth for what `/auth/invite` should render:
 * - no `token` param → invalid-invite state immediately (form never renders,
 *   on SSR or first client paint, so "Join undefined →" can never appear);
 * - token present but lookup still in flight → loading;
 * - lookup error (network or server 400/404) → invalid with that message;
 * - resolved invitation → form, with label/name derived via fallbacks.
 */
export function getInviteView(input: {
  token: string | null | undefined;
  loading: boolean;
  invitation: InviteDetailsLike | null;
  error: string;
}): InviteView {
  if (!input.token) return { state: 'invalid', message: 'Invalid invitation link' };
  if (input.loading) return { state: 'loading' };
  if (input.error) return { state: 'invalid', message: input.error };
  if (!input.invitation) return { state: 'invalid', message: 'Invalid invitation link' };
  const workspaceName = resolveWorkspaceName(input.invitation);
  return {
    state: 'form',
    invitation: input.invitation,
    joinLabel: inviteJoinLabel(input.invitation),
    workspaceName,
    avatarInitial: workspaceName.charAt(0).toUpperCase(),
  };
}
