import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

const cliPath = new URL('../../dist/cli.js', import.meta.url).pathname;
const packageVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  .version as string;
const env = { ...process.env, TASKEY_REPO_KEY: '/tmp/taskey-test-repo', TASKEY_DB_PATH: '/tmp/taskey-test.sqlite' };

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
    env
  });
}

describe('CLI contract', () => {
  beforeAll(() => {
    build();
    expect(existsSync(cliPath)).toBe(true);
  });

  beforeEach(() => {
    spawnSync('rm', ['-f', '/tmp/taskey-test.sqlite'], { encoding: 'utf8' });
  });

  test('runs when invoked through a symlinked bin, like npm link', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'taskey-bin-'));
    const binPath = join(tempDir, 'taskey');
    symlinkSync(cliPath, binPath);

    try {
      const result = spawnSync(binPath, ['--version'], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe(`${packageVersion}\n`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('shows human help with no arguments', () => {
    const result = runTaskey();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('taskey list');
    expect(result.stdout).toContain('taskey json');
  });

  test('shows human help with --help', () => {
    const result = runTaskey(['--help']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('taskey create --title');
    expect(result.stdout).toContain('taskey json');
  });

  test('rejects unknown human commands with a friendly error', () => {
    const result = runTaskey(['ls']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command: ls');
    expect(result.stderr).toContain('list');
    expect(result.stderr).toContain('taskey --help');
  });

  test('machine json subcommand returns json error on missing input when stdin is not a tty', () => {
    const result = runTaskey(['json']);

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

  test('machine json subcommand returns json error on invalid json argument', () => {
    const result = runTaskey(['json', '{bad json']);

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

  test('machine json subcommand accepts json from stdin', () => {
    const result = runTaskey(['json'], '{"action":"list"}');

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ ok: true, tasks: [] });
  });

  test('human list shows friendly no tasks output', () => {
    const result = runTaskey(['list']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('No incomplete tasks.\n');
  });

  test('human next shows friendly no task output', () => {
    const result = runTaskey(['next']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('No unblocked incomplete tasks.');
  });

  test('human create and get show friendly output', () => {
    const created = runTaskey(['create', '--title', 'First task', '--description', 'Line 1\nLine 2']);

    expect(created.status).toBe(0);
    expect(created.stderr).toBe('');
    expect(created.stdout).toMatch(/Created task (tsk_[a-z0-9]+): First task\n/);
    const id = created.stdout.match(/(tsk_[a-z0-9]+)/)?.[1];
    expect(id).toBeTruthy();

    const got = runTaskey(['get', '--id', id ?? '']);
    expect(got.status).toBe(0);
    expect(got.stderr).toBe('');
    expect(got.stdout).toContain(`ID: ${id}`);
    expect(got.stdout).toContain('Status: open');
    expect(got.stdout).toContain('Description:\nLine 1\nLine 2');
  });

  test('human next shows full task details for the next task', () => {
    const created = runTaskey(['create', '--title', 'First task', '--description', 'Line 1\nLine 2']);

    expect(created.status).toBe(0);
    const id = created.stdout.match(/(tsk_[a-z0-9]+)/)?.[1];
    expect(id).toBeTruthy();

    const next = runTaskey(['next']);

    expect(next.status).toBe(0);
    expect(next.stderr).toBe('');
    expect(next.stdout).toContain(`ID: ${id}`);
    expect(next.stdout).toContain('Title: First task');
    expect(next.stdout).toContain('Status: open');
    expect(next.stdout).toContain('Prerequisites: none');
    expect(next.stdout).toContain('Description:\nLine 1\nLine 2');
  });

  test('human list --all shows open, blocked, and done in human order', () => {
    const open = runTaskey(['create', '--title', 'Open']);
    const openId = open.stdout.match(/(tsk_[a-z0-9]+)/)?.[1] ?? '';
    const blocked = runTaskey(['create', '--title', 'Blocked', '--prerequisite', openId]);
    const blockedId = blocked.stdout.match(/(tsk_[a-z0-9]+)/)?.[1] ?? '';
    const done = runTaskey(['create', '--title', 'Done']);
    const doneId = done.stdout.match(/(tsk_[a-z0-9]+)/)?.[1] ?? '';
    runTaskey(['complete', '--id', doneId]);

    const result = runTaskey(['list', '--all']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`${openId} [open] Open`);
    expect(result.stdout).toContain(`${blockedId} [blocked by: ${openId}] Blocked`);
    expect(result.stdout).toContain(`${doneId} [done] Done`);
    expect(result.stdout.indexOf('[open] Open')).toBeLessThan(result.stdout.indexOf('[blocked by:'));
    expect(result.stdout.indexOf('[blocked by:')).toBeLessThan(result.stdout.indexOf('[done] Done'));
  });

  test('human update can clear prerequisites', () => {
    const a = runTaskey(['create', '--title', 'A']);
    const aId = a.stdout.match(/(tsk_[a-z0-9]+)/)?.[1] ?? '';
    const b = runTaskey(['create', '--title', 'B', '--prerequisite', aId]);
    const bId = b.stdout.match(/(tsk_[a-z0-9]+)/)?.[1] ?? '';

    const updated = runTaskey(['update', '--id', bId, '--clear-prerequisites']);
    const got = runTaskey(['get', '--id', bId]);

    expect(updated.status).toBe(0);
    expect(updated.stdout).toContain(`Updated task ${bId}: B`);
    expect(got.stdout).toContain('Prerequisites: none');
  });

  test('human commands reject unexpected extra arguments', () => {
    const result = runTaskey(['get', '--id', 'tsk_123', 'extra']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown argument');
  });

  test('human delete-all runs without extra confirmation', () => {
    runTaskey(['create', '--title', 'A']);
    runTaskey(['create', '--title', 'B']);

    const result = runTaskey(['delete-all']);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('Deleted 2 tasks.\n');
  });
});
