import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveRepoKey } from '../src/git.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'taskey-git-test-'));
}

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result;
}

describe('Git repository scoping', () => {
  test('resolves the current git root from a subdirectory as a realpath repo key', () => {
    const repo = tempDir();
    git(repo, ['init']);
    const subdir = join(repo, 'a', 'b');
    spawnSync('mkdir', ['-p', subdir]);

    expect(resolveRepoKey(subdir)).toBe(realpathSync(repo));
  });

  test('fails outside a git repository', () => {
    const dir = tempDir();

    try {
      resolveRepoKey(dir);
      throw new Error('Expected resolveRepoKey to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_GIT_REPOSITORY' });
    }
  });

  test('different git repositories get different repo keys', () => {
    const repoA = tempDir();
    const repoB = tempDir();
    git(repoA, ['init']);
    git(repoB, ['init']);

    expect(resolveRepoKey(repoA)).not.toBe(resolveRepoKey(repoB));
  });
});
