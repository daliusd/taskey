#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { TaskeyError, toErrorResponse } from './errors.js';
import { resolveRepoKey } from './git.js';
import { readRequest } from './input.js';
import { normalizeFields, projectTask } from './projection.js';
import { TaskService } from './tasks.js';

const actions = new Set([
  'create',
  'get',
  'list',
  'list-doable',
  'next',
  'update',
  'complete',
  'reopen',
  'delete',
  'delete-all'
]);

export function run(argv = process.argv.slice(2)): number {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    const request = readRequest(argv);

    if (request === 'help') {
      process.stdout.write('Usage: taskey \'{"action":"list"}\'\n       echo \'{"action":"list"}\' | taskey\n');
      return 0;
    }

    if (request === 'version') {
      process.stdout.write(`${readPackageVersion()}\n`);
      return 0;
    }

    if (!actions.has(request.action)) {
      throw new TaskeyError('UNKNOWN_ACTION', `Unknown action: ${request.action}`);
    }

    if ((request.action === 'delete' || request.action === 'delete-all') && request.fields !== undefined) {
      throw new TaskeyError('INVALID_INPUT', `fields is not allowed on ${request.action}.`);
    }

    const fields = normalizeFields(request.fields);
    const repoKey = resolveRepoKey();
    db = openDb();
    const service = new TaskService(db, repoKey);

    switch (request.action) {
      case 'create': {
        const task = service.create(request.data);
        process.stdout.write(JSON.stringify({ ok: true, task: projectTask(task, fields) }));
        return 0;
      }
      case 'get': {
        const task = service.get(readIdData(request.data));
        process.stdout.write(JSON.stringify({ ok: true, task: projectTask(task, fields) }));
        return 0;
      }
      case 'list': {
        const tasks = service.list().map((task) => projectTask(task, fields));
        process.stdout.write(JSON.stringify({ ok: true, tasks }));
        return 0;
      }
      case 'list-doable': {
        const tasks = service.listDoable().map((task) => projectTask(task, fields));
        process.stdout.write(JSON.stringify({ ok: true, tasks }));
        return 0;
      }
      case 'next': {
        const task = service.next();
        process.stdout.write(JSON.stringify({ ok: true, task: task ? projectTask(task, fields) : null }));
        return 0;
      }
      case 'update': {
        const task = service.update(request.data);
        process.stdout.write(JSON.stringify({ ok: true, task: projectTask(task, fields) }));
        return 0;
      }
      case 'complete': {
        const task = service.complete(request.data);
        process.stdout.write(JSON.stringify({ ok: true, task: projectTask(task, fields) }));
        return 0;
      }
      case 'reopen': {
        const task = service.reopen(request.data);
        process.stdout.write(JSON.stringify({ ok: true, task: projectTask(task, fields) }));
        return 0;
      }
      case 'delete': {
        const result = service.delete(request.data);
        process.stdout.write(JSON.stringify({ ok: true, ...result }));
        return 0;
      }
      case 'delete-all': {
        const result = service.deleteAll(request.data);
        process.stdout.write(JSON.stringify({ ok: true, ...result }));
        return 0;
      }
    }

    throw new TaskeyError('UNKNOWN_ACTION', `Unknown action: ${request.action}`);
  } catch (error) {
    process.stdout.write(JSON.stringify(toErrorResponse(error)));
    return 1;
  } finally {
    db?.close();
  }
}

function readIdData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new TaskeyError('INVALID_INPUT', 'data must be an object.');
  const keys = Object.keys(data);
  if (keys.some((key) => key !== 'id'))
    throw new TaskeyError('INVALID_INPUT', `Unknown data field: ${keys.find((key) => key !== 'id')}`);
  return (data as { id?: unknown }).id;
}

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.1.0';
  }
}

function isEntrypoint(): boolean {
  if (!process.argv[1]) return false;

  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.exitCode = run();
}
