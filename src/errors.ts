export type ErrorCode =
  | 'MISSING_INPUT'
  | 'INVALID_JSON'
  | 'UNKNOWN_ACTION'
  | 'AMBIGUOUS_INPUT'
  | 'INVALID_ARGUMENTS'
  | 'NOT_GIT_REPOSITORY'
  | 'INVALID_INPUT'
  | 'INVALID_TASK_ID'
  | 'TASK_NOT_FOUND'
  | 'TASK_HAS_DEPENDENTS'
  | 'DEPENDENCY_CYCLE'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_STASH_NAME'
  | 'STASH_NOT_FOUND'
  | 'STASH_ALREADY_EXISTS'
  | 'NO_ACTIVE_TASKS'
  | 'ACTIVE_TASKS_EXIST';

export class TaskeyError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'TaskeyError';
  }
}

export function toErrorResponse(error: unknown) {
  if (error instanceof TaskeyError) {
    return { ok: false, error: { code: error.code, message: error.message, ...error.details } } as const;
  }

  return {
    ok: false,
    error: {
      code: 'UNKNOWN_ACTION',
      message: error instanceof Error ? error.message : 'Unknown error.'
    }
  } as const;
}
