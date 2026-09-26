/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * File-based secret materialization (#2123).
 *
 * `docker inspect` leaks every `environment:` value of a running container to
 * any user in the docker group. Composing the app with secret files bind
 * mounted at /run/secrets (see docker-compose.secrets.yml) keeps the values
 * out of container metadata: each file's name maps to an env var
 * (`jwt_secret` -> `JWT_SECRET`) and its trimmed content becomes the value —
 * but only when the variable is not already set, so `.env` files and
 * orchestrator-injected env keep precedence.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

export const DEFAULT_SECRETS_DIR = '/run/secrets';

function secretsDir(): string {
  return process.env['SECRETS_DIR'] || DEFAULT_SECRETS_DIR;
}

/** `jwt_secret` / `jwt-secret` / `JWT_SECRET` -> `JWT_SECRET` */
function fileToEnvName(fileName: string): string {
  return fileName.replace(/-/g, '_').toUpperCase();
}

/**
 * Reads every regular file in the secrets directory into process.env.
 * Returns the env var names that were actually set. No-op (empty array) when
 * the directory does not exist, so hosts without the overlay are unaffected.
 */
export function materializeFileSecrets(): string[] {
  const dir = secretsDir();
  if (!existsSync(dir)) return [];

  const applied: string[] = [];
  for (const entry of readdirSync(dir)) {
    const filePath = `${dir}/${entry}`;
    let content: string;
    try {
      if (!statSync(filePath).isFile()) continue;
      content = readFileSync(filePath, 'utf8').trim();
    } catch {
      // Unreadable/symlink-stripped entry — skip it, never crash startup.
      continue;
    }
    if (!content) continue;
    const name = fileToEnvName(entry);
    if (process.env[name] === undefined || process.env[name] === '') {
      process.env[name] = content;
      applied.push(name);
    }
  }
  return applied;
}
