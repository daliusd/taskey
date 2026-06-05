import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

const cliPath = new URL('../../dist/cli.js', import.meta.url).pathname;

function build() {
  const result = spawnSync('npm', ['run', 'build'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Build failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  }
}

function runTaskey(args: string[] = [], input?: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, TASKEY_REPO_KEY: '/tmp/taskey-test-repo', TASKEY_DB_PATH: '/tmp/taskey-test.sqlite' }
  });
}

describe('CLI JSON contract', () => {
  beforeAll(() => {
    build();
    expect(existsSync(cliPath)).toBe(true);
  });

  test('runs when invoked through a symlinked bin, like npm link', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'taskey-bin-'));
    const binPath = join(tempDir, 'taskey');
    symlinkSync(cliPath, binPath);

    try {
      const result = spawnSync(binPath, ['--version'], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('0.1.0\n');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('returns JSON error on missing input', () => {
    const result = runTaskey();

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'MISSING_INPUT',
        message: 'Pass request JSON as an argument or via stdin.'
      }
    });
  });

  test('returns JSON error on invalid JSON argument', () => {
    const result = runTaskey(['{bad json']);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'INVALID_JSON',
        message: 'Input must be valid JSON.'
      }
    });
  });

  test('returns JSON error on unknown action', () => {
    const result = runTaskey(['{"action":"bogus"}']);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'UNKNOWN_ACTION',
        message: 'Unknown action: bogus'
      }
    });
  });

  test('accepts JSON from stdin', () => {
    const result = runTaskey([], '{"action":"list"}');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, tasks: [] });
  });

  test('rejects ambiguous argument and stdin JSON', () => {
    const result = runTaskey(['{"action":"list"}'], '{"action":"list"}');

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'AMBIGUOUS_INPUT',
        message: 'Pass request JSON either as an argument or via stdin, not both.'
      }
    });
  });

  test('rejects multiple positional arguments', () => {
    const result = runTaskey(['{"action":"list"}', '{"action":"next"}']);

    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'Expected exactly one JSON argument or stdin.'
      }
    });
  });
});
