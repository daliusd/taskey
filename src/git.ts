import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { TaskeyError } from './errors.js';

export function resolveRepoKey(cwd = process.cwd()): string {
  if (process.env.TASKEY_REPO_KEY) {
    return process.env.TASKEY_REPO_KEY;
  }

  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new TaskeyError('NOT_GIT_REPOSITORY', 'Taskey must be run inside a Git repository.');
  }

  const root = result.stdout.trim();
  if (!root) {
    throw new TaskeyError('NOT_GIT_REPOSITORY', 'Taskey must be run inside a Git repository.');
  }

  return realpathSync(root);
}
