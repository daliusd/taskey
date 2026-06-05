import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openDb } from '../src/db.js';
import { getDbPath } from '../src/paths.js';

describe('database path', () => {
  test('uses TASKEY_DB_PATH override', () => {
    expect(getDbPath({ TASKEY_DB_PATH: '/tmp/custom.sqlite' })).toBe('/tmp/custom.sqlite');
  });

  test('uses XDG_DATA_HOME on linux-like platforms', () => {
    expect(getDbPath({ XDG_DATA_HOME: '/tmp/data' }, 'linux', '/home/me')).toBe(
      join('/tmp/data', 'taskey', 'taskey.sqlite')
    );
  });

  test('falls back to ~/.local/share on linux-like platforms', () => {
    expect(getDbPath({}, 'linux', '/home/me')).toBe(join('/home/me', '.local', 'share', 'taskey', 'taskey.sqlite'));
  });

  test('creates database directories and initializes schema', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'taskey-db-test-')), 'nested', 'taskey.sqlite');
    const db = openDb(path);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[];
    db.close();

    expect(existsSync(path)).toBe(true);
    expect(tables.map((table) => table.name)).toContain('schema_version');
    expect(tables.map((table) => table.name)).toContain('tasks');
    expect(tables.map((table) => table.name)).toContain('task_prerequisites');
  });
});
