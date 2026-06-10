import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';

const cliPath = new URL('../../dist/cli.js', import.meta.url).pathname;
let dbPath: string;
let repoKey: string;

function build() {
  const result = spawnSync('npm', ['run', 'build'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
}

function taskey(request: unknown) {
  const result = spawnSync(process.execPath, [cliPath, 'json', JSON.stringify(request)], {
    encoding: 'utf8',
    env: { ...process.env, TASKEY_REPO_KEY: repoKey, TASKEY_DB_PATH: dbPath }
  });
  return { status: result.status, stderr: result.stderr, json: JSON.parse(result.stdout) };
}

function okTask(request: unknown) {
  const result = taskey(request);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.json.ok).toBe(true);
  return result.json.task;
}

beforeAll(build);

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'taskey-e2e-'));
  dbPath = join(dir, 'taskey.sqlite');
  repoKey = join(dir, 'repo');
});

describe('task operations', () => {
  test('creates, gets, lists, updates, completes, reopens, and deletes tasks', () => {
    const created = okTask({ action: 'create', data: { title: '  First task  ' } });
    expect(created).toMatchObject({ title: 'First task', description: '', prerequisites: [], completed: false });
    expect(created.id).toMatch(/^tsk_[a-z0-9]+$/);

    expect(taskey({ action: 'get', data: { id: created.id }, fields: ['title'] }).json).toEqual({
      ok: true,
      task: { id: created.id, title: 'First task' }
    });

    expect(
      taskey({
        action: 'update',
        data: { id: created.id, description: '  keep whitespace  ' },
        fields: ['description']
      }).json
    ).toEqual({
      ok: true,
      task: { id: created.id, description: '  keep whitespace  ' }
    });

    expect(taskey({ action: 'complete', data: { id: created.id }, fields: ['completed'] }).json).toEqual({
      ok: true,
      task: { id: created.id, completed: true }
    });
    expect(taskey({ action: 'reopen', data: { id: created.id }, fields: ['completed'] }).json.task.completed).toBe(
      false
    );

    expect(taskey({ action: 'list', fields: [] }).json).toEqual({ ok: true, tasks: [{ id: created.id }] });
    expect(taskey({ action: 'delete', data: { id: created.id } }).json).toEqual({
      ok: true,
      deleted: true,
      id: created.id
    });
    expect(taskey({ action: 'list' }).json).toEqual({ ok: true, tasks: [] });
  });

  test('computes doable tasks and next from prerequisites', () => {
    const a = okTask({ action: 'create', data: { title: 'A' } });
    const b = okTask({ action: 'create', data: { title: 'B', prerequisites: [a.id] } });

    expect(taskey({ action: 'list-doable', fields: ['title'] }).json).toEqual({
      ok: true,
      tasks: [{ id: a.id, title: 'A' }]
    });
    expect(taskey({ action: 'next', fields: ['title'] }).json).toEqual({ ok: true, task: { id: a.id, title: 'A' } });

    taskey({ action: 'complete', data: { id: a.id } });
    expect(taskey({ action: 'list-doable', fields: ['title'] }).json).toEqual({
      ok: true,
      tasks: [{ id: b.id, title: 'B' }]
    });

    taskey({ action: 'complete', data: { id: b.id } });
    expect(taskey({ action: 'next' }).json).toEqual({ ok: true, task: null });
  });

  test('isolates tasks by repo key in the same database', () => {
    const firstRepo = repoKey;
    const a = okTask({ action: 'create', data: { title: 'A' } });
    repoKey = `${firstRepo}-other`;
    expect(taskey({ action: 'list' }).json).toEqual({ ok: true, tasks: [] });
    repoKey = firstRepo;
    expect(taskey({ action: 'list', fields: ['title'] }).json.tasks).toEqual([{ id: a.id, title: 'A' }]);
  });

  test('rejects invalid input, dependency cycles, and deleting dependencies', () => {
    const a = okTask({ action: 'create', data: { title: 'A' } });
    const b = okTask({ action: 'create', data: { title: 'B', prerequisites: [a.id] } });

    expect(taskey({ action: 'create', data: { title: 'x', unknown: true } }).json.error.code).toBe('INVALID_INPUT');
    expect(taskey({ action: 'get', data: { id: 'bad' } }).json.error.code).toBe('INVALID_TASK_ID');
    expect(taskey({ action: 'get', data: { id: 'tsk_missing' } }).json.error.code).toBe('TASK_NOT_FOUND');
    expect(taskey({ action: 'update', data: { id: a.id, prerequisites: [b.id] } }).json.error.code).toBe(
      'DEPENDENCY_CYCLE'
    );
    expect(taskey({ action: 'delete', data: { id: a.id } }).json).toMatchObject({
      ok: false,
      error: { code: 'TASK_HAS_DEPENDENTS', dependents: [b.id] }
    });
  });

  test('delete-all requires confirmation and rejects fields or unknown data', () => {
    expect(taskey({ action: 'delete-all' }).json).toEqual({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED', message: 'delete-all requires data.confirm to be true.' }
    });
    expect(taskey({ action: 'delete-all', data: { confirm: false } }).json.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(taskey({ action: 'delete-all', data: { confirm: true, force: true } }).json.error.code).toBe(
      'INVALID_INPUT'
    );
    expect(taskey({ action: 'delete-all', data: { confirm: true }, fields: [] }).json.error.code).toBe('INVALID_INPUT');
  });

  test('delete-all deletes all current-repo tasks and bypasses dependency protections', () => {
    const firstRepo = repoKey;
    const a = okTask({ action: 'create', data: { title: 'A' } });
    okTask({ action: 'create', data: { title: 'B', prerequisites: [a.id] } });
    repoKey = `${firstRepo}-other`;
    const other = okTask({ action: 'create', data: { title: 'Other repo task' } });

    repoKey = firstRepo;
    expect(taskey({ action: 'delete-all', data: { confirm: true } }).json).toEqual({ ok: true, deleted: 2 });
    expect(taskey({ action: 'list' }).json).toEqual({ ok: true, tasks: [] });
    expect(taskey({ action: 'delete-all', data: { confirm: true } }).json).toEqual({ ok: true, deleted: 0 });

    repoKey = `${firstRepo}-other`;
    expect(taskey({ action: 'list', fields: ['title'] }).json.tasks).toEqual([
      { id: other.id, title: 'Other repo task' }
    ]);
  });

  test('stashes active tasks and restores them with ids, state, prerequisites, and order preserved', () => {
    const a = okTask({ action: 'create', data: { title: 'A' } });
    const b = okTask({ action: 'create', data: { title: 'B', prerequisites: [a.id] } });
    taskey({ action: 'complete', data: { id: a.id } });

    expect(taskey({ action: 'stash', data: { name: 'sprint 1' } }).json).toEqual({
      ok: true,
      stash: { name: 'sprint 1', taskCount: 2 }
    });
    expect(taskey({ action: 'list' }).json).toEqual({ ok: true, tasks: [] });
    expect(taskey({ action: 'get', data: { id: a.id } }).json.error.code).toBe('TASK_NOT_FOUND');
    expect(taskey({ action: 'stashes' }).json).toEqual({
      ok: true,
      stashes: [{ name: 'sprint 1', taskCount: 2 }]
    });
    expect(
      taskey({ action: 'list', data: { stash: 'sprint 1' }, fields: ['title', 'completed', 'prerequisites'] }).json
    ).toEqual({
      ok: true,
      tasks: [
        { id: a.id, title: 'A', prerequisites: [], completed: true },
        { id: b.id, title: 'B', prerequisites: [a.id], completed: false }
      ]
    });
    expect(
      taskey({ action: 'get', data: { id: b.id, stash: 'sprint 1' }, fields: ['title', 'prerequisites'] }).json
    ).toEqual({
      ok: true,
      task: { id: b.id, title: 'B', prerequisites: [a.id] }
    });

    expect(taskey({ action: 'unstash', data: { name: 'sprint 1' } }).json).toEqual({
      ok: true,
      stash: { name: 'sprint 1', taskCount: 2 }
    });
    expect(taskey({ action: 'stashes' }).json).toEqual({ ok: true, stashes: [] });
    expect(taskey({ action: 'list', fields: ['title', 'completed', 'prerequisites'] }).json).toEqual({
      ok: true,
      tasks: [
        { id: a.id, title: 'A', prerequisites: [], completed: true },
        { id: b.id, title: 'B', prerequisites: [a.id], completed: false }
      ]
    });
  });

  test('validates stash operations and keeps stashes isolated per repo', () => {
    expect(taskey({ action: 'stash', data: { name: 'empty' } }).json.error.code).toBe('NO_ACTIVE_TASKS');
    expect(taskey({ action: 'stash', data: { name: 'bad/name' } }).json.error.code).toBe('INVALID_STASH_NAME');
    expect(taskey({ action: 'list', data: { stash: 'missing' } }).json.error.code).toBe('STASH_NOT_FOUND');
    expect(taskey({ action: 'get', data: { id: 'tsk_missing', stash: 'missing' } }).json.error.code).toBe(
      'STASH_NOT_FOUND'
    );

    okTask({ action: 'create', data: { title: 'A' } });
    expect(taskey({ action: 'stash', data: { name: 'same' } }).json.ok).toBe(true);
    okTask({ action: 'create', data: { title: 'B' } });
    expect(taskey({ action: 'stash', data: { name: 'same' } }).json.error.code).toBe('STASH_ALREADY_EXISTS');
    expect(taskey({ action: 'unstash', data: { name: 'same' } }).json.error.code).toBe('ACTIVE_TASKS_EXIST');
    expect(taskey({ action: 'delete-all', data: { confirm: true } }).json).toEqual({ ok: true, deleted: 1 });

    const firstRepo = repoKey;
    repoKey = `${firstRepo}-other`;
    okTask({ action: 'create', data: { title: 'Other' } });
    expect(taskey({ action: 'stash', data: { name: 'same' } }).json.ok).toBe(true);
    expect(taskey({ action: 'stashes' }).json).toEqual({ ok: true, stashes: [{ name: 'same', taskCount: 1 }] });

    repoKey = firstRepo;
    expect(taskey({ action: 'stashes' }).json).toEqual({ ok: true, stashes: [{ name: 'same', taskCount: 1 }] });
  });

  test('rejects stash selectors for next and list-doable', () => {
    expect(taskey({ action: 'next', data: { stash: 'sprint 1' } }).json.error.code).toBe('INVALID_INPUT');
    expect(taskey({ action: 'list-doable', data: { stash: 'sprint 1' } }).json.error.code).toBe('INVALID_INPUT');
  });
});
