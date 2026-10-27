/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { z } from 'zod';
import { requiredString } from './common';
import { isRegistrableRedirectUri } from '@/lib/auth/oauth-client';

/**
 * #3328. `client_id` and `client_secret` are absent by design: the server mints both
 * (`lib/auth/oauth-client.ts`) and a registration form that could choose an id would be
 * an admin handing out somebody else's — the column carries a unique constraint precisely
 * so ids are not up for bid.
 *
 * The fields are unrefined so `.partial()` can derive the PATCH contract from them, the
 * way #2258 had to do for tickets; the URI rules are attached afterwards.
 */
const oauthClientFields = z.object({
  name: requiredString.max(120),
  redirect_uris: z.array(z.string().trim().min(1).max(2000)).min(1, 'At least one redirect URI is required').max(20),
});

function rejectUnregistrable(uris: string[], ctx: z.RefinementCtx, path: string[]) {
  for (const uri of uris) {
    const why = isRegistrableRedirectUri(uri);
    if (why) ctx.addIssue({ code: z.ZodIssueCode.custom, path, message: `redirect_uri "${uri}" ${why}` });
  }
}

export const registerOAuthClientSchema = oauthClientFields.superRefine((v, ctx) => {
  rejectUnregistrable(v.redirect_uris, ctx, ['redirect_uris']);
});

export const updateOAuthClientSchema = oauthClientFields
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .superRefine((v, ctx) => {
    if (v.redirect_uris) rejectUnregistrable(v.redirect_uris, ctx, ['redirect_uris']);
  });

export type RegisterOAuthClientInput = z.infer<typeof registerOAuthClientSchema>;
export type UpdateOAuthClientInput = z.infer<typeof updateOAuthClientSchema>;
