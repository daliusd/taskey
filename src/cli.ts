#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { TaskeyError, toErrorResponse } from './errors.js';
import { resolveRepoKey } from './git.js';
import { type RequestEnvelope, readJsonRequest } from './input.js';
import { normalizeFields, projectTask } from './projection.js';
import { type PublicTask, type StashInfo, TaskService } from './tasks.js';

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
  'delete-all',
  'stash',
  'stashes',
  'unstash'
]);

const humanCommands = [
  'list',
  'list-doable',
  'next',
  'get',
  'create',
  'update',
  'complete',
  'reopen',
  'delete',
  'delete-all',
  'stash',
  'stashes',
  'unstash',
  'json'
];

type HumanCommand =
  | { kind: 'list'; all: boolean; stash?: string; request: RequestEnvelope }
  | { kind: 'list-doable'; request: RequestEnvelope }
  | { kind: 'next'; request: RequestEnvelope }
  | { kind: 'get'; stash?: string; request: RequestEnvelope }
  | { kind: 'create'; request: RequestEnvelope }
  | { kind: 'update'; request: RequestEnvelope }
  | { kind: 'complete'; request: RequestEnvelope }
  | { kind: 'reopen'; request: RequestEnvelope }
  | { kind: 'delete'; request: RequestEnvelope }
  | { kind: 'delete-all'; request: RequestEnvelope }
  | { kind: 'stash'; request: RequestEnvelope }
  | { kind: 'stashes'; request: RequestEnvelope }
  | { kind: 'unstash'; request: RequestEnvelope };

export function run(argv = process.argv.slice(2)): number {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    process.stdout.write(helpText());
    return 0;
  }

  if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(`${readPackageVersion()}\n`);
    return 0;
  }

  if (argv[0] === 'json') {
    return runJson(argv.slice(1));
  }

  return runHuman(argv);
}

function runJson(argv: string[]): number {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    if (argv.length === 0 && process.stdin.isTTY) {
      process.stdout.write(jsonUsageText());
      return 0;
    }

    const request = readJsonRequest(argv);
    const repoKey = resolveRepoKey();
    db = openDb();
    const service = new TaskService(db, repoKey);
    process.stdout.write(JSON.stringify(executeRequest(service, request)));
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify(toErrorResponse(error)));
    return 1;
  } finally {
    db?.close();
  }
}

function runHuman(argv: string[]): number {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    const command = parseHumanCommand(argv);
    const repoKey = resolveRepoKey();
    db = openDb();
    const service = new TaskService(db, repoKey);
    const response = executeRequest(service, command.request);
    process.stdout.write(formatHumanResponse(command, response, service));
    return 0;
  } catch (error) {
    process.stderr.write(`${formatHumanError(error)}\n`);
    return 1;
  } finally {
    db?.close();
  }
}

function executeRequest(service: TaskService, request: RequestEnvelope): Record<string, unknown> {
  if (!actions.has(request.action)) {
    throw new TaskeyError('UNKNOWN_ACTION', `Unknown action: ${request.action}`);
  }

  const taskReturningActions = new Set([
    'create',
    'get',
    'list',
    'list-doable',
    'next',
    'update',
    'complete',
    'reopen'
  ]);
  if (!taskReturningActions.has(request.action) && request.fields !== undefined) {
    throw new TaskeyError('INVALID_INPUT', `fields is not allowed on ${request.action}.`);
  }

  const fields = normalizeFields(request.fields);

  switch (request.action) {
    case 'create': {
      const task = service.create(request.data);
      return { ok: true, task: projectTask(task, fields) };
    }
    case 'get': {
      const data = readGetData(request.data);
      const task = data.stash === undefined ? service.get(data.id) : service.getStashTask(data.id, data.stash);
      return { ok: true, task: projectTask(task, fields) };
    }
    case 'list': {
      const data = readListData(request.data);
      const tasks = (data.stash === undefined ? service.list() : service.listStashTasks(data.stash)).map((task) =>
        projectTask(task, fields)
      );
      return { ok: true, tasks };
    }
    case 'list-doable': {
      rejectData(request.data, request.action);
      const tasks = service.listDoable().map((task) => projectTask(task, fields));
      return { ok: true, tasks };
    }
    case 'next': {
      rejectData(request.data, request.action);
      const task = service.next();
      return { ok: true, task: task ? projectTask(task, fields) : null };
    }
    case 'update': {
      const task = service.update(request.data);
      return { ok: true, task: projectTask(task, fields) };
    }
    case 'complete': {
      const task = service.complete(request.data);
      return { ok: true, task: projectTask(task, fields) };
    }
    case 'reopen': {
      const task = service.reopen(request.data);
      return { ok: true, task: projectTask(task, fields) };
    }
    case 'delete': {
      return { ok: true, ...service.delete(request.data) };
    }
    case 'delete-all': {
      return { ok: true, ...service.deleteAll(request.data) };
    }
    case 'stash': {
      return { ok: true, stash: service.stash(request.data) };
    }
    case 'stashes': {
      rejectData(request.data, request.action);
      return { ok: true, stashes: service.listStashes() };
    }
    case 'unstash': {
      return { ok: true, stash: service.unstash(request.data) };
    }
  }

  throw new TaskeyError('UNKNOWN_ACTION', `Unknown action: ${request.action}`);
}

function parseHumanCommand(argv: string[]): HumanCommand {
  const [name, ...rest] = argv;
  switch (name) {
    case 'list': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--stash'], booleanFlags: ['--all'] });
      const stash = readOptionalFlag(flags, '--stash');
      return {
        kind: 'list',
        all: flags.booleans.has('--all'),
        stash,
        request: { action: 'list', ...(stash === undefined ? {} : { data: { stash } }) }
      };
    }
    case 'list-doable':
      expectNoArgs(name, rest);
      return { kind: 'list-doable', request: { action: 'list-doable' } };
    case 'next':
      expectNoArgs(name, rest);
      return { kind: 'next', request: { action: 'next' } };
    case 'get': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--id', '--stash'], booleanFlags: [] });
      const stash = readOptionalFlag(flags, '--stash');
      return {
        kind: 'get',
        stash,
        request: {
          action: 'get',
          data: { id: readRequiredFlag(flags, '--id'), ...(stash === undefined ? {} : { stash }) }
        }
      };
    }
    case 'create': {
      const flags = parseFlagArgs(rest, {
        valueFlags: ['--title', '--description', '--prerequisite'],
        booleanFlags: []
      });
      return {
        kind: 'create',
        request: {
          action: 'create',
          data: {
            title: readRequiredFlag(flags, '--title'),
            ...readOptionalDescription(flags),
            ...readPrerequisites(flags, { allowClear: false })
          }
        }
      };
    }
    case 'update': {
      const flags = parseFlagArgs(rest, {
        valueFlags: ['--id', '--title', '--description', '--prerequisite'],
        booleanFlags: ['--clear-prerequisites']
      });
      const id = readRequiredFlag(flags, '--id');
      const title = readOptionalFlag(flags, '--title');
      const description = readOptionalFlag(flags, '--description');
      const prerequisites = readPrerequisites(flags, { allowClear: true });
      const data: Record<string, unknown> = { id };
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if ('prerequisites' in prerequisites) data.prerequisites = prerequisites.prerequisites;
      if (Object.keys(data).length === 1) {
        throw new TaskeyError(
          'INVALID_ARGUMENTS',
          'update requires --title, --description, --prerequisite, or --clear-prerequisites.'
        );
      }
      return { kind: 'update', request: { action: 'update', data } };
    }
    case 'complete': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--id'], booleanFlags: [] });
      return { kind: 'complete', request: { action: 'complete', data: { id: readRequiredFlag(flags, '--id') } } };
    }
    case 'reopen': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--id'], booleanFlags: [] });
      return { kind: 'reopen', request: { action: 'reopen', data: { id: readRequiredFlag(flags, '--id') } } };
    }
    case 'delete': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--id'], booleanFlags: [] });
      return { kind: 'delete', request: { action: 'delete', data: { id: readRequiredFlag(flags, '--id') } } };
    }
    case 'delete-all':
      expectNoArgs(name, rest);
      return { kind: 'delete-all', request: { action: 'delete-all', data: { confirm: true } } };
    case 'stash': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--name'], booleanFlags: [] });
      return { kind: 'stash', request: { action: 'stash', data: { name: readRequiredFlag(flags, '--name') } } };
    }
    case 'stashes':
      expectNoArgs(name, rest);
      return { kind: 'stashes', request: { action: 'stashes' } };
    case 'unstash': {
      const flags = parseFlagArgs(rest, { valueFlags: ['--name'], booleanFlags: [] });
      return { kind: 'unstash', request: { action: 'unstash', data: { name: readRequiredFlag(flags, '--name') } } };
    }
    default:
      throw unknownHumanCommand(name);
  }
}

type ParsedFlags = { values: Map<string, string[]>; booleans: Set<string> };

function parseFlagArgs(argv: string[], options: { valueFlags: string[]; booleanFlags: string[] }): ParsedFlags {
  const values = new Map<string, string[]>();
  const booleans = new Set<string>();
  const valueFlags = new Set(options.valueFlags);
  const booleanFlags = new Set(options.booleanFlags);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new TaskeyError('INVALID_ARGUMENTS', `Unknown argument: ${arg}`);
    if (valueFlags.has(arg)) {
      const next = argv[i + 1];
      if (next === undefined) throw new TaskeyError('INVALID_ARGUMENTS', `Missing value for ${arg}`);
      values.set(arg, [...(values.get(arg) ?? []), next]);
      i++;
      continue;
    }
    if (booleanFlags.has(arg)) {
      booleans.add(arg);
      continue;
    }
    throw new TaskeyError('INVALID_ARGUMENTS', `Unknown argument: ${arg}`);
  }

  return { values, booleans };
}

function readRequiredFlag(flags: ParsedFlags, flag: string): string {
  const value = readOptionalFlag(flags, flag);
  if (value === undefined) throw new TaskeyError('INVALID_ARGUMENTS', `Missing required argument: ${flag}`);
  return value;
}

function readOptionalDescription(flags: ParsedFlags): Record<string, string> {
  const description = readOptionalFlag(flags, '--description');
  return description === undefined ? {} : { description };
}

function readPrerequisites(
  flags: ParsedFlags,
  options: { allowClear: boolean }
): Record<'prerequisites', string[]> | Record<string, never> {
  const prerequisites = flags.values.get('--prerequisite') ?? [];
  const clear = flags.booleans.has('--clear-prerequisites');
  if (clear && !options.allowClear) {
    throw new TaskeyError('INVALID_ARGUMENTS', '--clear-prerequisites is only allowed on update.');
  }
  if (clear && prerequisites.length > 0) {
    throw new TaskeyError('INVALID_ARGUMENTS', 'Use either --prerequisite or --clear-prerequisites, not both.');
  }
  if (clear) return { prerequisites: [] };
  if (prerequisites.length > 0) return { prerequisites };
  return {};
}

function readOptionalFlag(flags: ParsedFlags, flag: string): string | undefined {
  const values = flags.values.get(flag);
  return values?.[values.length - 1];
}

function expectNoArgs(command: string, argv: string[]): void {
  if (argv.length > 0) throw new TaskeyError('INVALID_ARGUMENTS', `${command} does not accept arguments.`);
}

function formatHumanResponse(command: HumanCommand, response: Record<string, unknown>, service: TaskService): string {
  switch (command.kind) {
    case 'list': {
      const tasks = ((response.tasks as PublicTask[] | undefined) ?? []).filter(
        (task) => command.all || !task.completed
      );
      const resolver = taskResolver(service, command.stash);
      const ordered = sortTasksForHumans(tasks, resolver);
      if (ordered.length === 0) return command.all ? 'No tasks.\n' : 'No incomplete tasks.\n';
      return `${ordered.map((task) => formatTaskLine(task, resolver)).join('\n')}\n`;
    }
    case 'list-doable': {
      const tasks = (response.tasks as PublicTask[] | undefined) ?? [];
      if (tasks.length === 0) return 'No unblocked incomplete tasks.\n';
      const resolver = taskResolver(service);
      return `${tasks.map((task) => formatTaskLine(task, resolver)).join('\n')}\n`;
    }
    case 'next': {
      const task = (response.task as PublicTask | null | undefined) ?? null;
      if (!task) return 'No unblocked incomplete tasks.\n';
      return formatTaskDetails(task, taskResolver(service));
    }
    case 'get': {
      const task = response.task as PublicTask;
      return formatTaskDetails(task, taskResolver(service, command.stash));
    }
    case 'create': {
      const task = response.task as PublicTask;
      return `Created task ${task.id}: ${task.title}\n`;
    }
    case 'update': {
      const task = response.task as PublicTask;
      return `Updated task ${task.id}: ${task.title}\n`;
    }
    case 'complete': {
      const task = response.task as PublicTask;
      return `Completed task ${task.id}: ${task.title}\n`;
    }
    case 'reopen': {
      const task = response.task as PublicTask;
      return `Reopened task ${task.id}: ${task.title}\n`;
    }
    case 'delete':
      return `Deleted task ${String(response.id)}.\n`;
    case 'delete-all':
      return `Deleted ${String(response.deleted)} tasks.\n`;
    case 'stash': {
      const stash = response.stash as StashInfo;
      return `Stashed ${stash.taskCount} ${stash.taskCount === 1 ? 'task' : 'tasks'} in ${stash.name}.\n`;
    }
    case 'stashes': {
      const stashes = (response.stashes as StashInfo[] | undefined) ?? [];
      if (stashes.length === 0) return 'No stashes.\n';
      return `${stashes.map((stash) => `${stash.name}  ${stash.taskCount} ${stash.taskCount === 1 ? 'task' : 'tasks'}`).join('\n')}\n`;
    }
    case 'unstash': {
      const stash = response.stash as StashInfo;
      return `Unstashed ${stash.taskCount} ${stash.taskCount === 1 ? 'task' : 'tasks'} from ${stash.name}.\n`;
    }
  }
}

type TaskResolver = (id: string) => PublicTask;

function taskResolver(service: TaskService, stash?: string): TaskResolver {
  return stash === undefined ? (id) => service.get(id) : (id) => service.getStashTask(id, stash);
}

function formatTaskDetails(task: PublicTask, resolver: TaskResolver): string {
  const status = getTaskStatus(task, resolver);
  const description = task.description === '' ? '(empty)' : task.description;
  return [
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${status.label}`,
    `Prerequisites: ${task.prerequisites.length === 0 ? 'none' : task.prerequisites.join(', ')}`,
    'Description:',
    description,
    ''
  ].join('\n');
}

function formatTaskLine(task: PublicTask, resolver: TaskResolver): string {
  const status = getTaskStatus(task, resolver);
  if (status.label === 'blocked') return `${task.id} [blocked by: ${status.blockedBy.join(', ')}] ${task.title}`;
  return `${task.id} [${status.label}] ${task.title}`;
}

function sortTasksForHumans(tasks: PublicTask[], resolver: TaskResolver): PublicTask[] {
  const open: PublicTask[] = [];
  const blocked: PublicTask[] = [];
  const done: PublicTask[] = [];

  for (const task of tasks) {
    const status = getTaskStatus(task, resolver);
    if (status.label === 'done') done.push(task);
    else if (status.label === 'blocked') blocked.push(task);
    else open.push(task);
  }

  return [...open, ...blocked, ...done];
}

function getTaskStatus(
  task: PublicTask,
  resolver: TaskResolver
): { label: 'open' | 'blocked' | 'done'; blockedBy: string[] } {
  if (task.completed) return { label: 'done', blockedBy: [] };
  const blockedBy = task.prerequisites.filter((id) => !resolver(id).completed);
  if (blockedBy.length > 0) return { label: 'blocked', blockedBy };
  return { label: 'open', blockedBy: [] };
}

function formatHumanError(error: unknown): string {
  if (error instanceof TaskeyError) return error.message;
  return error instanceof Error ? error.message : 'Unknown error.';
}

function unknownHumanCommand(command: string | undefined): TaskeyError {
  const shown = command && command.length > 0 ? command : '(missing)';
  const suggestion = closestCommand(command);
  const hint = suggestion
    ? ` Did you mean: ${suggestion}? Run 'taskey --help' for usage.`
    : " Run 'taskey --help' for usage.";
  return new TaskeyError('INVALID_ARGUMENTS', `Unknown command: ${shown}.${hint}`);
}

function closestCommand(command: string | undefined): string | undefined {
  if (!command) return undefined;
  if (command === 'ls') return 'list';
  if (command.startsWith('li')) return 'list';
  if (command.startsWith('del')) return 'delete';
  return humanCommands.find((candidate) => candidate.startsWith(command[0] ?? ''));
}

function readGetData(data: unknown): { id: unknown; stash?: unknown } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TaskeyError('INVALID_INPUT', 'data must be an object.');
  }
  const input = data as { id?: unknown; stash?: unknown };
  const keys = Object.keys(input);
  const extra = keys.find((key) => key !== 'id' && key !== 'stash');
  if (extra) throw new TaskeyError('INVALID_INPUT', `Unknown data field: ${extra}`);
  return { id: input.id, ...(input.stash === undefined ? {} : { stash: input.stash }) };
}

function readListData(data: unknown): { stash?: unknown } {
  if (data === undefined) return {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new TaskeyError('INVALID_INPUT', 'data must be an object.');
  }
  const input = data as { stash?: unknown };
  const keys = Object.keys(input);
  const extra = keys.find((key) => key !== 'stash');
  if (extra) throw new TaskeyError('INVALID_INPUT', `Unknown data field: ${extra}`);
  return input.stash === undefined ? {} : { stash: input.stash };
}

function rejectData(data: unknown, action: string): void {
  if (data !== undefined) throw new TaskeyError('INVALID_INPUT', `data is not allowed on ${action}.`);
}

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: string;
    };
    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function helpText(): string {
  return [
    'Usage:',
    '  taskey <command> [options]',
    '',
    'Human commands:',
    '  taskey list [--all] [--stash <name>]',
    '  taskey list-doable',
    '  taskey next',
    '  taskey get --id <task-id> [--stash <name>]',
    '  taskey create --title <title> [--description <text>] [--prerequisite <task-id> ...]',
    '  taskey update --id <task-id> [--title <title>] [--description <text>] [--prerequisite <task-id> ...] [--clear-prerequisites]',
    '  taskey complete --id <task-id>',
    '  taskey reopen --id <task-id>',
    '  taskey delete --id <task-id>',
    '  taskey delete-all',
    '  taskey stash --name <name>',
    '  taskey stashes',
    '  taskey unstash --name <name>',
    '',
    'Machine mode:',
    "  taskey json '" + '{"action":"list"}' + "'",
    "  echo '" + '{"action":"next"}' + "' | taskey json",
    ''
  ].join('\n');
}

function jsonUsageText(): string {
  return [
    'Usage:',
    "  taskey json '" + '{"action":"list"}' + "'",
    "  echo '" + '{"action":"next"}' + "' | taskey json",
    ''
  ].join('\n');
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
