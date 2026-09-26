/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { logError } from '@/lib/errors-server';

export async function checkDirExists(path: string): Promise<boolean> {
  try {
    const fs = await import('fs');
    return fs.existsSync(path);
  } catch (err) {
    await logError({ error: err, context: `backups: checkDirExists ${path}` });
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  const fs = await import('fs');
  if (!fs.existsSync(path)) {
    fs.mkdirSync(path, { recursive: true });
  }
}

export async function deleteFile(path: string): Promise<void> {
  const fs = await import('fs');
  if (fs.existsSync(path)) {
    fs.unlinkSync(path);
  }
}

export async function getFileStats(path: string): Promise<{ size: number } | null> {
  try {
    const fs = await import('fs');
    const stats = fs.statSync(path);
    return { size: stats.size };
  } catch {
    // Fallback to default on corrupted storage data
    return null;
  }
}