export async function checkDirExists(path: string): Promise<boolean> {
  try {
    const fs = await import('fs');
    return fs.existsSync(path);
  } catch {
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
    return null;
  }
}