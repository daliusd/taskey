import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildJudgePrompt,
  parseEvalFileContent,
  parseJudgeOutput,
  parsePiJsonOutput,
  parseRunnerArgs,
  persistEvalRunArtifacts,
  prepareIsolatedEvalRepo,
  runCommandStreaming,
  runSingleEval
} from '../src/evalRunner.js';

describe('skill eval runner parsing', () => {
  test('parses eval file content with optional files arrays', () => {
    const evalFile = parseEvalFileContent(
      JSON.stringify({
        skill_name: 'taskey',
        evals: [
          {
            id: 1,
            prompt: 'Break this project into implementation tasks',
            expected_output: 'Creates self-contained taskey tasks',
            files: []
          },
          {
            id: 'fixture-case',
            prompt: 'Use this starter fixture',
            expected_output: 'Mentions the fixture contents',
            files: ['fixtures/starter.ts']
          }
        ]
      })
    );

    expect(evalFile.skillName).toBe('taskey');
    expect(evalFile.evals).toEqual([
      {
        id: '1',
        prompt: 'Break this project into implementation tasks',
        expectedOutput: 'Creates self-contained taskey tasks',
        files: []
      },
      {
        id: 'fixture-case',
        prompt: 'Use this starter fixture',
        expectedOutput: 'Mentions the fixture contents',
        files: ['fixtures/starter.ts']
      }
    ]);
  });

  test('validates strict judge JSON', () => {
    const grade = parseJudgeOutput(
      JSON.stringify({
        passed: true,
        score: 0.9,
        reason: 'The output used taskey and included validation commands.',
        missing: []
      })
    );

    expect(grade).toEqual({
      status: 'graded',
      passed: true,
      score: 0.9,
      reason: 'The output used taskey and included validation commands.',
      missing: []
    });
  });

  test('turns invalid judge output into a grade error', () => {
    const grade = parseJudgeOutput('The output looks pretty good to me.');

    expect(grade.status).toBe('grade_error');
    expect(grade.passed).toBe(false);
    expect(grade.score).toBe(0);
    expect(grade.reason).toContain('valid JSON');
  });

  test('turns judge schema violations into a grade error', () => {
    const grade = parseJudgeOutput(
      JSON.stringify({
        passed: true,
        score: 1.5,
        reason: 'Too high',
        missing: 'nothing'
      })
    );

    expect(grade.status).toBe('grade_error');
    expect(grade.passed).toBe(false);
    expect(grade.score).toBe(0);
    expect(grade.reason).toContain('judge schema');
  });

  test('parses runner arguments with defaults derived from eval file', () => {
    const options = parseRunnerArgs(['--evals', 'skills/taskey/evals/evals.json', '--limit', '2']);

    expect(options).toEqual({
      evalsPath: 'skills/taskey/evals/evals.json',
      skillPath: 'skills/taskey',
      outPath: undefined,
      model: 'openai-codex/gpt-5.4',
      limit: 2,
      repoPath: undefined,
      thinking: undefined,
      verbosity: 'quiet'
    });
  });

  test('allows overriding the default eval model', () => {
    const options = parseRunnerArgs(['--model', 'test-model']);

    expect(options.model).toBe('test-model');
  });

  test('parses verbose as progress verbosity', () => {
    const options = parseRunnerArgs([
      '--repo',
      'skills/taskey/evals/fixtures/minimal-repo',
      '--thinking',
      'off',
      '--verbose'
    ]);

    expect(options.repoPath).toBe('skills/taskey/evals/fixtures/minimal-repo');
    expect(options.thinking).toBe('off');
    expect(options.verbosity).toBe('progress');
  });

  test('parses explicit full verbosity', () => {
    const options = parseRunnerArgs(['--verbosity', 'full']);

    expect(options.verbosity).toBe('full');
  });

  test('extracts final assistant text from Pi JSONL output', () => {
    const output = parsePiJsonOutput(
      [
        JSON.stringify({ type: 'session', id: 'abc' }),
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'First tool request' }]
          }
        }),
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'hidden' },
              { type: 'text', text: 'Final answer' }
            ]
          }
        })
      ].join('\n')
    );

    expect(output).toEqual({ actualOutput: 'Final answer' });
  });

  test('falls back to raw Pi JSONL when no final assistant text exists', () => {
    const jsonl = JSON.stringify({ type: 'session', id: 'abc' });

    expect(parsePiJsonOutput(jsonl)).toEqual({ actualOutput: jsonl });
  });

  test('builds a strict JSON judge prompt with taskey evidence', () => {
    const prompt = buildJudgePrompt({
      prompt: 'Continue the next dev task in this repo.',
      expectedOutput: 'Uses taskey next/list-doable before implementation.',
      actualOutput: 'I completed the next task.',
      taskeyCommands: ['taskey "{"action":"next"}"'],
      taskeyState: '{"ok":true,"tasks":[{"id":"tsk_1","description":"Detailed task body"}]}'
    });

    expect(prompt).toContain('Return only valid JSON');
    expect(prompt).toContain('"passed"');
    expect(prompt).toContain('Continue the next dev task');
    expect(prompt).toContain('Uses taskey next/list-doable');
    expect(prompt).toContain('I completed the next task.');
    expect(prompt).toContain('Taskey command evidence');
    expect(prompt).toContain('taskey "{"action":"next"}"');
    expect(prompt).toContain('Taskey state after run');
    expect(prompt).toContain('Detailed task body');
  });

  test('truncates oversized taskey evidence in judge prompts', () => {
    const prompt = buildJudgePrompt({
      prompt: 'Break this repo into tasks.',
      expectedOutput: 'Uses taskey create.',
      actualOutput: 'Created tasks.',
      taskeyCommands: ['taskey create'],
      taskeyState: 'x'.repeat(20_000)
    });

    expect(prompt.length).toBeLessThan(16_000);
    expect(prompt).toContain('[truncated');
  });

  test('streams command stdout lines while still returning complete stdout', async () => {
    const lines: string[] = [];
    const output = await runCommandStreaming(
      process.execPath,
      ['-e', "console.log('first'); setTimeout(() => console.log('second'), 10);"],
      {
        cwd: process.cwd(),
        onStdoutLine: (line) => lines.push(line)
      }
    );

    expect(output).toBe('first\nsecond');
    expect(lines).toEqual(['first', 'second']);
  });

  test('runs one eval by invoking pi for the skill and judge', async () => {
    const calls: { command: string; args: string[]; cwd?: string; hasStdoutLineHandler: boolean }[] = [];
    const result = await runSingleEval(
      {
        id: '1',
        prompt: 'Break this repo into tasks.',
        expectedOutput: 'Uses taskey create.',
        files: []
      },
      {
        skillPath: '/repo/skills/taskey',
        cwd: '/repo',
        model: 'test-model',
        thinking: 'off',
        logger: () => undefined,
        piEventLogger: () => undefined,
        exec: async (command, args, options) => {
          calls.push({ command, args, cwd: options.cwd, hasStdoutLineHandler: options.onStdoutLine !== undefined });
          if (calls.length === 1) {
            return [
              JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Created taskey tasks.' }] }
              }),
              JSON.stringify({
                type: 'turn_end',
                message: {
                  role: 'assistant',
                  content: [
                    {
                      type: 'toolCall',
                      name: 'bash',
                      arguments: { command: 'taskey \'{"action":"create"}\'' }
                    }
                  ]
                }
              })
            ].join('\n');
          }
          if (command === 'taskey') {
            if (args[0] === '{"action":"list"}') {
              return JSON.stringify({ ok: true, tasks: [{ id: 'tsk_1' }] });
            }
            if (args[0] === '{"action":"get","data":{"id":"tsk_1"}}') {
              return JSON.stringify({ ok: true, task: { id: 'tsk_1', description: 'Detailed task body' } });
            }
          }
          return JSON.stringify({ passed: true, score: 1, reason: 'Met expectations.', missing: [] });
        }
      }
    );

    expect(calls).toHaveLength(4);
    expect(calls[0]).toEqual({
      command: 'pi',
      args: [
        '--mode',
        'json',
        '--model',
        'test-model',
        '--thinking',
        'off',
        '--skill',
        '/repo/skills/taskey',
        'Break this repo into tasks.'
      ],
      cwd: '/repo',
      hasStdoutLineHandler: true
    });
    expect(calls[1]).toEqual({
      command: 'taskey',
      args: ['{"action":"list"}'],
      cwd: '/repo',
      hasStdoutLineHandler: false
    });
    expect(calls[2]).toEqual({
      command: 'taskey',
      args: ['{"action":"get","data":{"id":"tsk_1"}}'],
      cwd: '/repo',
      hasStdoutLineHandler: false
    });
    expect(calls[3]?.command).toBe('pi');
    expect(calls[3]?.args.slice(0, 5)).toEqual(['-p', '--model', 'test-model', '--thinking', 'off']);
    expect(calls[3]?.hasStdoutLineHandler).toBe(false);
    expect(result.actualOutput).toBe('Created taskey tasks.');
    expect(result.piEventsJsonl).toContain('Created taskey tasks.');
    expect(result.judgePrompt).toContain('Taskey command evidence');
    expect(result.judgePrompt).toContain('taskey');
    expect(result.judgePrompt).toContain('Detailed task body');
    expect(result.grade.status).toBe('graded');
    expect(result.grade.passed).toBe(true);
  });

  test('logs skill and judge stages when logger is supplied', async () => {
    const messages: string[] = [];
    await runSingleEval(
      {
        id: '1',
        prompt: 'Break this repo into tasks.',
        expectedOutput: 'Uses taskey create.',
        files: []
      },
      {
        skillPath: '/repo/skills/taskey',
        cwd: '/repo',
        logger: (message) => messages.push(message),
        piEventLogger: () => undefined,
        exec: async () =>
          messages.some((message) => message.includes('skill Pi finished'))
            ? JSON.stringify({ passed: true, score: 1, reason: 'Met expectations.', missing: [] })
            : 'Created taskey tasks.'
      }
    );

    expect(messages).toEqual([
      '[eval 1] starting skill Pi run',
      '[eval 1] skill Pi finished',
      '[eval 1] starting judge Pi run',
      '[eval 1] judge Pi finished'
    ]);
  });

  test('progress pi event logger emits dots', async () => {
    const messages: string[] = [];
    await runSingleEval(
      {
        id: '1',
        prompt: 'Break this repo into tasks.',
        expectedOutput: 'Uses taskey create.',
        files: []
      },
      {
        skillPath: '/repo/skills/taskey',
        cwd: '/repo',
        logger: (message) => messages.push(message),
        piEventLogger: () => messages.push('.'),
        exec: async (_command, _args, options) => {
          options.onStdoutLine?.('{"type":"turn_start"}');
          return messages.some((message) => message.includes('skill Pi finished'))
            ? JSON.stringify({ passed: true, score: 1, reason: 'Met expectations.', missing: [] })
            : JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Created taskey tasks.' }] }
              });
        }
      }
    );

    expect(messages).toContain('.');
    expect(messages).not.toContain('[eval 1] pi event {"type":"turn_start"}');
  });

  test('full pi event logger emits raw event lines', async () => {
    const messages: string[] = [];
    await runSingleEval(
      {
        id: '1',
        prompt: 'Break this repo into tasks.',
        expectedOutput: 'Uses taskey create.',
        files: []
      },
      {
        skillPath: '/repo/skills/taskey',
        cwd: '/repo',
        logger: (message) => messages.push(message),
        piEventLogger: (line) => messages.push(`[eval 1] pi event ${line}`),
        exec: async (_command, _args, options) => {
          options.onStdoutLine?.('{"type":"turn_start"}');
          return messages.some((message) => message.includes('skill Pi finished'))
            ? JSON.stringify({ passed: true, score: 1, reason: 'Met expectations.', missing: [] })
            : JSON.stringify({
                type: 'message_end',
                message: { role: 'assistant', content: [{ type: 'text', text: 'Created taskey tasks.' }] }
              });
        }
      }
    );

    expect(messages).toContain('[eval 1] pi event {"type":"turn_start"}');
  });

  test('judge command evidence ignores partial streaming fragments and keeps final bash tool call', async () => {
    const outputs = [
      [
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: {
            partial: {
              content: [
                {
                  type: 'toolCall',
                  name: 'bash',
                  arguments: { command: 'taskey \'{"action":"del' }
                }
              ]
            }
          }
        }),
        JSON.stringify({
          type: 'turn_end',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'toolCall',
                name: 'bash',
                arguments: { command: 'taskey \'{"action":"delete-all","data":{"confirm":true}}\'' }
              }
            ]
          }
        }),
        JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Cleared tasks.' }]
          }
        })
      ].join('\n'),
      JSON.stringify({ passed: true, score: 1, reason: 'Met expectations.', missing: [] })
    ];

    const result = await runSingleEval(
      {
        id: '3',
        prompt: 'Use taskey to clear all tasks for this project; we are starting the plan from scratch.',
        expectedOutput:
          'Uses taskey delete-all with explicit confirmation for the current repo only and summarizes the deleted count.',
        files: []
      },
      {
        skillPath: '/repo/skills/taskey',
        cwd: '/repo',
        exec: async (command, args) => {
          if (command === 'taskey' && args[0] === '{"action":"list"}') {
            return JSON.stringify({ ok: true, tasks: [] });
          }
          return outputs.shift() ?? '';
        }
      }
    );

    expect(result.judgePrompt).toContain('taskey \'{"action":"delete-all","data":{"confirm":true}}\'');
    expect(result.judgePrompt).not.toContain('message_update');
    expect(result.judgePrompt).not.toContain('assistantMessageEvent');
  });

  test('records judge parse failures as grade errors for one eval', async () => {
    const outputs = [
      JSON.stringify({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'A plausible skill answer.' }] }
      }),
      'not json'
    ];
    const result = await runSingleEval(
      {
        id: '1',
        prompt: 'Break this repo into tasks.',
        expectedOutput: 'Uses taskey create.',
        files: []
      },
      {
        skillPath: '/repo/skills/taskey',
        cwd: '/repo',
        exec: async () => outputs.shift() ?? ''
      }
    );

    expect(result.actualOutput).toBe('A plausible skill answer.');
    expect(result.grade.status).toBe('grade_error');
    expect(result.grade.passed).toBe(false);
  });

  test('prepares an isolated temp repo and excludes generated dependencies', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'taskey-real-repo-'));
    writeFileSync(join(repoRoot, 'package.json'), '{}');
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(join(repoRoot, 'src', 'index.ts'), 'export {};');
    await mkdir(join(repoRoot, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(repoRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};');
    await mkdir(join(repoRoot, 'dist'), { recursive: true });
    writeFileSync(join(repoRoot, 'dist', 'cli.js'), '');
    await mkdir(join(repoRoot, '.git'), { recursive: true });
    writeFileSync(join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main');
    await mkdir(join(repoRoot, 'skills', 'taskey', 'evals', 'runs', 'old'), { recursive: true });
    writeFileSync(join(repoRoot, 'skills', 'taskey', 'evals', 'runs', 'old', 'summary.json'), '{}');

    const gitCalls: { command: string; args: string[]; cwd: string }[] = [];
    const isolated = await prepareIsolatedEvalRepo(
      repoRoot,
      {
        id: '1',
        prompt: 'Prompt',
        expectedOutput: 'Expected',
        files: []
      },
      {
        exec: async (command, args, options) => {
          gitCalls.push({ command, args, cwd: options.cwd });
          return '';
        }
      }
    );

    expect(isolated.cwd).not.toBe(repoRoot);
    expect(existsSync(join(isolated.cwd, 'package.json'))).toBe(true);
    expect(existsSync(join(isolated.cwd, 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(isolated.cwd, 'node_modules'))).toBe(false);
    expect(existsSync(join(isolated.cwd, 'dist'))).toBe(false);
    expect(existsSync(join(isolated.cwd, '.git', 'HEAD'))).toBe(false);
    expect(existsSync(join(isolated.cwd, 'skills', 'taskey', 'evals', 'runs'))).toBe(false);
    expect(gitCalls).toEqual([{ command: 'git', args: ['init'], cwd: isolated.cwd }]);
    await isolated.cleanup();
    expect(existsSync(isolated.cwd)).toBe(false);
  });

  test('logs isolated repo preparation steps when logger is supplied', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'taskey-real-repo-'));
    writeFileSync(join(repoRoot, 'package.json'), '{}');
    const messages: string[] = [];

    const isolated = await prepareIsolatedEvalRepo(
      repoRoot,
      {
        id: '1',
        prompt: 'Prompt',
        expectedOutput: 'Expected',
        files: []
      },
      {
        logger: (message) => messages.push(message),
        exec: async () => ''
      }
    );

    expect(messages[0]).toBe('[eval 1] preparing isolated repo');
    expect(messages[1]).toBe(`[eval 1] copying repo snapshot to ${isolated.cwd}`);
    expect(messages[2]).toBe(`[eval 1] initializing git repo in ${isolated.cwd}`);
    expect(messages[3]).toBe(`[eval 1] isolated repo ready at ${isolated.cwd}`);
    await isolated.cleanup();
  });

  test('fails before invoking commands when an eval fixture is missing', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'taskey-real-repo-'));
    const calls: string[] = [];

    await expect(
      prepareIsolatedEvalRepo(
        repoRoot,
        {
          id: 'missing-fixture',
          prompt: 'Prompt',
          expectedOutput: 'Expected',
          files: ['fixtures/missing.ts']
        },
        {
          exec: async (command) => {
            calls.push(command);
            return '';
          }
        }
      )
    ).rejects.toThrow('Missing eval fixture');

    expect(calls).toEqual([]);
  });

  test('persists per-eval artifacts and aggregate summaries', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'taskey-eval-run-'));
    const summary = {
      skillName: 'taskey',
      total: 2,
      passed: 1,
      failed: 1,
      gradeErrors: 0,
      results: [
        {
          eval: {
            id: '1',
            prompt: 'Break this repo into tasks.',
            expectedOutput: 'Uses taskey create.',
            files: []
          },
          actualOutput: 'Created taskey tasks.',
          piEventsJsonl: '{"type":"message_end"}',
          judgePrompt: 'Grade eval 1',
          grade: {
            status: 'graded' as const,
            passed: true,
            score: 1,
            reason: 'Met expectations.',
            missing: []
          }
        },
        {
          eval: {
            id: '2',
            prompt: 'Continue next task.',
            expectedOutput: 'Runs taskey next.',
            files: []
          },
          actualOutput: 'I will inspect files first.',
          judgePrompt: 'Grade eval 2',
          grade: {
            status: 'graded' as const,
            passed: false,
            score: 0.25,
            reason: 'Did not call taskey.',
            missing: ['taskey next']
          }
        }
      ]
    };

    await persistEvalRunArtifacts(summary, {
      outPath: outDir,
      evalsPath: 'skills/taskey/evals/evals.json',
      timestamp: '2026-06-05T12:00:00.000Z'
    });

    expect(readFileSync(join(outDir, 'eval-1', 'prompt.txt'), 'utf8')).toBe('Break this repo into tasks.');
    expect(readFileSync(join(outDir, 'eval-1', 'actual.txt'), 'utf8')).toBe('Created taskey tasks.');
    expect(readFileSync(join(outDir, 'eval-1', 'judge-prompt.txt'), 'utf8')).toBe('Grade eval 1');
    expect(readFileSync(join(outDir, 'eval-1', 'pi-events.jsonl'), 'utf8')).toBe('{"type":"message_end"}');
    expect(JSON.parse(readFileSync(join(outDir, 'eval-1', 'grade.json'), 'utf8'))).toEqual(summary.results[0]?.grade);

    const summaryJson = JSON.parse(readFileSync(join(outDir, 'summary.json'), 'utf8'));
    expect(summaryJson).toMatchObject({
      skillName: 'taskey',
      evalsPath: 'skills/taskey/evals/evals.json',
      timestamp: '2026-06-05T12:00:00.000Z',
      total: 2,
      passed: 1,
      failed: 1,
      gradeErrors: 0
    });
    expect(summaryJson.results).toEqual([
      { id: '1', status: 'passed', score: 1, reason: 'Met expectations.' },
      { id: '2', status: 'failed', score: 0.25, reason: 'Did not call taskey.' }
    ]);

    const summaryMd = readFileSync(join(outDir, 'summary.md'), 'utf8');
    expect(summaryMd).toContain('# Skill eval run: taskey');
    expect(summaryMd).toContain('- Evals: `skills/taskey/evals/evals.json`');
    expect(summaryMd).toContain('| 1 | passed | 1 | Met expectations. |');
    expect(summaryMd).toContain('| 2 | failed | 0.25 | Did not call taskey. |');
  });
});
