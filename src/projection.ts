import { TaskeyError } from './errors.js';
import type { PublicTask, TaskField } from './tasks.js';

const allowed = new Set<TaskField>(['title', 'description', 'prerequisites', 'completed']);
const order: TaskField[] = ['title', 'description', 'prerequisites', 'completed'];

export function normalizeFields(fields: unknown): TaskField[] | undefined {
  if (fields === undefined) return undefined;
  if (
    !Array.isArray(fields) ||
    !fields.every((field) => typeof field === 'string' && allowed.has(field as TaskField))
  ) {
    throw new TaskeyError(
      'INVALID_INPUT',
      'fields must contain only title, description, prerequisites, and completed.'
    );
  }
  return order.filter((field) => fields.includes(field));
}

export function projectTask(task: PublicTask, fields?: TaskField[]): Partial<PublicTask> & { id: string } {
  const selected = fields ?? order;
  const output: Partial<PublicTask> & { id: string } = { id: task.id };
  for (const field of order) {
    if (selected.includes(field)) {
      (output as Record<string, unknown>)[field] = task[field];
    }
  }
  return output;
}
