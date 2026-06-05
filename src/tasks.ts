import { randomBytes } from 'node:crypto';
import type { Db } from './db.js';
import { TaskeyError } from './errors.js';

export type TaskField = 'title' | 'description' | 'prerequisites' | 'completed';
export type PublicTask = {
  id: string;
  title: string;
  description: string;
  prerequisites: string[];
  completed: boolean;
};

type TaskRow = { id: string; title: string; description: string; completed: 0 | 1; created_at: number };

const idPattern = /^tsk_[a-z0-9]+$/;

export class TaskService {
  constructor(
    private readonly db: Db,
    private readonly repoKey: string
  ) {}

  create(data: unknown): PublicTask {
    const input = object(data);
    strict(input, ['title', 'description', 'prerequisites']);
    const title = parseTitle(input.title);
    const description = parseDescription(input.description);
    const prerequisites = parsePrerequisites(input.prerequisites);
    this.validatePrerequisites(prerequisites);
    const now = Date.now();
    const id = this.generateId();
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO tasks(id, repo_key, title, description, completed, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
        )
        .run(id, this.repoKey, title, description, now, now);
      this.insertPrerequisites(id, prerequisites);
    })();
    return this.getExisting(id);
  }

  get(id: unknown): PublicTask {
    const taskId = parseId(id);
    return this.getExisting(taskId);
  }

  list(): PublicTask[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, description, completed, created_at FROM tasks WHERE repo_key = ? ORDER BY created_at ASC, id ASC'
      )
      .all(this.repoKey) as TaskRow[];
    return rows.map((row) => this.publicFromRow(row));
  }

  listDoable(): PublicTask[] {
    return this.list().filter(
      (task) => !task.completed && task.prerequisites.every((id) => this.getExisting(id).completed)
    );
  }

  next(): PublicTask | null {
    return this.listDoable()[0] ?? null;
  }

  update(data: unknown): PublicTask {
    const input = object(data);
    strict(input, ['id', 'title', 'description', 'prerequisites']);
    const id = parseId(input.id);
    this.ensureExists(id);
    const hasTitle = Object.hasOwn(input, 'title');
    const hasDescription = Object.hasOwn(input, 'description');
    const hasPrerequisites = Object.hasOwn(input, 'prerequisites');
    if (!hasTitle && !hasDescription && !hasPrerequisites)
      throw new TaskeyError('INVALID_INPUT', 'update requires at least one mutable field.');
    const title = hasTitle ? parseTitle(input.title) : undefined;
    const description = hasDescription ? parseDescription(input.description) : undefined;
    const prerequisites = hasPrerequisites ? parsePrerequisites(input.prerequisites) : undefined;
    if (prerequisites) {
      if (prerequisites.includes(id)) throw new TaskeyError('INVALID_INPUT', 'Task cannot depend on itself.');
      this.validatePrerequisites(prerequisites);
      if (this.createsCycle(id, prerequisites))
        throw new TaskeyError('DEPENDENCY_CYCLE', 'Prerequisites would create a dependency cycle.', {
          taskIds: [id, ...prerequisites]
        });
    }
    const now = Date.now();
    this.db.transaction(() => {
      if (hasTitle)
        this.db
          .prepare('UPDATE tasks SET title = ?, updated_at = ? WHERE id = ? AND repo_key = ?')
          .run(title, now, id, this.repoKey);
      if (hasDescription)
        this.db
          .prepare('UPDATE tasks SET description = ?, updated_at = ? WHERE id = ? AND repo_key = ?')
          .run(description, now, id, this.repoKey);
      if (prerequisites) {
        this.db.prepare('DELETE FROM task_prerequisites WHERE repo_key = ? AND task_id = ?').run(this.repoKey, id);
        this.insertPrerequisites(id, prerequisites);
        this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ? AND repo_key = ?').run(now, id, this.repoKey);
      }
    })();
    return this.getExisting(id);
  }

  complete(data: unknown): PublicTask {
    return this.setCompleted(data, true);
  }

  reopen(data: unknown): PublicTask {
    return this.setCompleted(data, false);
  }

  delete(data: unknown): { deleted: true; id: string } {
    const input = object(data);
    strict(input, ['id']);
    const id = parseId(input.id);
    this.ensureExists(id);
    const dependents = (
      this.db
        .prepare(
          'SELECT task_id FROM task_prerequisites WHERE repo_key = ? AND prerequisite_id = ? ORDER BY task_id ASC'
        )
        .all(this.repoKey, id) as { task_id: string }[]
    ).map((r) => r.task_id);
    if (dependents.length)
      throw new TaskeyError('TASK_HAS_DEPENDENTS', 'Task cannot be deleted because other tasks depend on it.', {
        dependents
      });
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM tasks WHERE id = ? AND repo_key = ?').run(id, this.repoKey);
    })();
    return { deleted: true, id };
  }

  deleteAll(data: unknown): { deleted: number } {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new TaskeyError('CONFIRMATION_REQUIRED', 'delete-all requires data.confirm to be true.');
    }
    const input = object(data);
    strict(input, ['confirm']);
    if (input.confirm !== true) {
      throw new TaskeyError('CONFIRMATION_REQUIRED', 'delete-all requires data.confirm to be true.');
    }

    let deleted = 0;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM task_prerequisites WHERE repo_key = ?').run(this.repoKey);
      const result = this.db.prepare('DELETE FROM tasks WHERE repo_key = ?').run(this.repoKey);
      deleted = result.changes;
    })();

    return { deleted };
  }

  private setCompleted(data: unknown, completed: boolean): PublicTask {
    const input = object(data);
    strict(input, ['id']);
    const id = parseId(input.id);
    this.ensureExists(id);
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE tasks SET completed = ?, updated_at = ? WHERE id = ? AND repo_key = ?')
        .run(completed ? 1 : 0, Date.now(), id, this.repoKey);
    })();
    return this.getExisting(id);
  }

  private generateId(): string {
    for (;;) {
      const id = `tsk_${randomBytes(8).toString('hex')}`;
      const exists = this.db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(id);
      if (!exists) return id;
    }
  }

  private getExisting(id: string): PublicTask {
    const row = this.db
      .prepare('SELECT id, title, description, completed, created_at FROM tasks WHERE id = ? AND repo_key = ?')
      .get(id, this.repoKey) as TaskRow | undefined;
    if (!row) throw new TaskeyError('TASK_NOT_FOUND', `Task not found: ${id}`);
    return this.publicFromRow(row);
  }

  private ensureExists(id: string): void {
    this.getExisting(id);
  }

  private publicFromRow(row: TaskRow): PublicTask {
    const prerequisites = (
      this.db
        .prepare(
          'SELECT prerequisite_id FROM task_prerequisites WHERE repo_key = ? AND task_id = ? ORDER BY prerequisite_id ASC'
        )
        .all(this.repoKey, row.id) as { prerequisite_id: string }[]
    ).map((r) => r.prerequisite_id);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      prerequisites,
      completed: row.completed === 1
    };
  }

  private insertPrerequisites(taskId: string, prerequisites: string[]): void {
    const stmt = this.db.prepare('INSERT INTO task_prerequisites(repo_key, task_id, prerequisite_id) VALUES (?, ?, ?)');
    for (const prerequisite of prerequisites) stmt.run(this.repoKey, taskId, prerequisite);
  }

  private validatePrerequisites(prerequisites: string[]): void {
    for (const id of prerequisites) this.ensureExists(id);
  }

  private createsCycle(taskId: string, prerequisites: string[]): boolean {
    const visit = (id: string, seen: Set<string>): boolean => {
      if (id === taskId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      const next = (
        this.db
          .prepare('SELECT prerequisite_id FROM task_prerequisites WHERE repo_key = ? AND task_id = ?')
          .all(this.repoKey, id) as { prerequisite_id: string }[]
      ).map((r) => r.prerequisite_id);
      return next.some((prereq) => visit(prereq, seen));
    };
    return prerequisites.some((id) => visit(id, new Set()));
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TaskeyError('INVALID_INPUT', 'data must be an object.');
  return value as Record<string, unknown>;
}

function strict(input: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) throw new TaskeyError('INVALID_INPUT', `Unknown data field: ${extra}`);
}

function parseTitle(value: unknown): string {
  if (typeof value !== 'string') throw new TaskeyError('INVALID_INPUT', 'data.title is required.');
  const title = value.trim();
  if (!title) throw new TaskeyError('INVALID_INPUT', 'data.title must not be empty.');
  if (title.length > 500) throw new TaskeyError('INVALID_INPUT', 'data.title must be at most 500 characters.');
  return title;
}

function parseDescription(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new TaskeyError('INVALID_INPUT', 'data.description must be a string.');
  if (value.length > 20_000)
    throw new TaskeyError('INVALID_INPUT', 'data.description must be at most 20000 characters.');
  return value;
}

function parsePrerequisites(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TaskeyError('INVALID_INPUT', 'data.prerequisites must be an array.');
  if (value.length > 100) throw new TaskeyError('INVALID_INPUT', 'data.prerequisites must contain at most 100 items.');
  const ids = value.map(parseId);
  if (new Set(ids).size !== ids.length)
    throw new TaskeyError('INVALID_INPUT', 'data.prerequisites must not contain duplicate IDs.');
  return ids;
}

function parseId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value))
    throw new TaskeyError('INVALID_TASK_ID', 'Task ID is malformed.');
  return value;
}
