import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function getDbPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir()
): string {
  if (env.TASKEY_DB_PATH) return env.TASKEY_DB_PATH;

  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'taskey', 'taskey.sqlite');
  if (platform === 'win32') {
    const base = env.APPDATA ?? join(home, 'AppData', 'Roaming');
    return join(base, 'taskey', 'taskey.sqlite');
  }

  const base = env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  return join(base, 'taskey', 'taskey.sqlite');
}

export function ensureDbDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}
