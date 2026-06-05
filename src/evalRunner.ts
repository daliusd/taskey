import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const DEFAULT_EVAL_MODEL = 'openai-codex/gpt-5.4';

const rawEvalCaseSchema = z.object({
  id: z.union([z.string(), z.number()]),
  prompt: z.string().min(1),
  expected_output: z.string().min(1),
  files: z.array(z.string()).default([])
});

const rawEvalFileSchema = z.object({
  skill_name: z.string().min(1),
  evals: z.array(rawEvalCaseSchema)
});

const judgeSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  reason: z.string(),
  missing: z.array(z.string())
});

export type SkillEvalCase = {
  id: string;
  prompt: string;
  expectedOutput: string;
  files: string[];
};

export type SkillEvalFile = {
  skillName: string;
  evals: SkillEvalCase[];
};

export type Logger = (message: string) => void;

export type Verbosity = 'quiet' | 'progress' | 'full';

export type RunnerOptions = {
  evalsPath: string;
  skillPath: string;
  outPath?: string;
  model?: string;
  limit?: number;
  repoPath?: string;
  thinking?: string;
  verbosity: Verbosity;
};

export type ExecOptions = {
  cwd: string;
  onStdoutLine?: (line: string) => void;
};

export type ExecFunction = (command: string, args: string[], options: ExecOptions) => Promise<string>;

export type IsolatedEvalRepo = {
  cwd: string;
  cleanup: () => Promise<void>;
};

export type PrepareIsolatedEvalRepoOptions = {
  exec?: ExecFunction;
  logger?: Logger;
};

export type RunSingleEvalOptions = {
  skillPath: string;
  cwd: string;
  model?: string;
  thinking?: string;
  exec?: ExecFunction;
  logger?: Logger;
  piEventLogger?: (line: string) => void;
};

export type SingleEvalResult = {
  eval: SkillEvalCase;
  actualOutput: string;
  piEventsJsonl?: string;
  judgePrompt: string;
  grade: JudgeResult;
};

export type EvalRunSummary = {
  skillName: string;
  total: number;
  passed: number;
  failed: number;
  gradeErrors: number;
  results: SingleEvalResult[];
};

export type PersistEvalRunArtifactsOptions = {
  outPath: string;
  evalsPath: string;
  timestamp?: string;
};

export type JudgeResult =
  | {
      status: 'graded';
      passed: boolean;
      score: number;
      reason: string;
      missing: string[];
    }
  | {
      status: 'grade_error';
      passed: false;
      score: 0;
      reason: string;
      missing: string[];
    };

export function parseEvalFileContent(content: string): SkillEvalFile {
  const parsedJson = JSON.parse(content) as unknown;
  const parsed = rawEvalFileSchema.parse(parsedJson);

  return {
    skillName: parsed.skill_name,
    evals: parsed.evals.map((evalCase) => ({
      id: String(evalCase.id),
      prompt: evalCase.prompt,
      expectedOutput: evalCase.expected_output,
      files: evalCase.files
    }))
  };
}

export function parseRunnerArgs(args: string[]): RunnerOptions {
  const options: Partial<RunnerOptions> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--evals') {
      options.evalsPath = requireValue(args, ++index, arg);
    } else if (arg === '--skill') {
      options.skillPath = requireValue(args, ++index, arg);
    } else if (arg === '--out') {
      options.outPath = requireValue(args, ++index, arg);
    } else if (arg === '--model') {
      options.model = requireValue(args, ++index, arg);
    } else if (arg === '--limit') {
      options.limit = parseLimit(requireValue(args, ++index, arg));
    } else if (arg === '--repo') {
      options.repoPath = requireValue(args, ++index, arg);
    } else if (arg === '--thinking') {
      options.thinking = requireValue(args, ++index, arg);
    } else if (arg === '--verbosity') {
      options.verbosity = parseVerbosity(requireValue(args, ++index, arg));
    } else if (arg === '--verbose') {
      options.verbosity = 'progress';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const evalsPath = options.evalsPath ?? 'skills/taskey/evals/evals.json';
  return {
    evalsPath,
    skillPath: options.skillPath ?? deriveSkillPathFromEvalsPath(evalsPath),
    outPath: options.outPath,
    model: options.model ?? DEFAULT_EVAL_MODEL,
    limit: options.limit,
    repoPath: options.repoPath,
    thinking: options.thinking,
    verbosity: options.verbosity ?? 'quiet'
  };
}

export function buildJudgePrompt(input: {
  prompt: string;
  expectedOutput: string;
  actualOutput: string;
  taskeyCommands?: string[];
  taskeyState?: string;
}): string {
  const taskeyCommandsSection =
    input.taskeyCommands === undefined || input.taskeyCommands.length === 0
      ? ''
      : `

Taskey command evidence:
${truncateForPrompt(input.taskeyCommands.map((command) => `- ${command}`).join('\n'), 2_000)}`;
  const taskeyStateSection =
    input.taskeyState === undefined
      ? ''
      : `

Taskey state after run:
${truncateForPrompt(input.taskeyState, 8_000)}`;

  return `You are grading whether an AI coding agent correctly followed a skill eval.

Return only valid JSON with this exact shape:
{
  "passed": boolean,
  "score": number between 0 and 1,
  "reason": string,
  "missing": string[]
}

Grade semantically. The actual output does not need exact wording, but it must satisfy the expected behavior.
If Taskey command evidence or Taskey state is provided, use it to judge actual behavior, not only what the user-facing summary chose to mention.${taskeyCommandsSection}${taskeyStateSection}

User prompt:
${input.prompt}

Expected output:
${input.expectedOutput}

Actual output:
${input.actualOutput}`;
}

export async function prepareIsolatedEvalRepo(
  repoRoot: string,
  evalCase: SkillEvalCase,
  options: PrepareIsolatedEvalRepoOptions = {}
): Promise<IsolatedEvalRepo> {
  logEval(evalCase, options.logger, 'preparing isolated repo');
  for (const fixture of evalCase.files) {
    const fixturePath = join(repoRoot, fixture);
    if (!existsSync(fixturePath)) {
      throw new Error(`Missing eval fixture: ${fixture}`);
    }
  }

  const cwd = await mkdtemp(join(tmpdir(), 'taskey-skill-eval-'));
  logEval(evalCase, options.logger, `copying repo snapshot to ${cwd}`);
  await cp(repoRoot, cwd, {
    recursive: true,
    filter: (source) => shouldCopyPath(repoRoot, source)
  });

  const exec = options.exec ?? defaultExec;
  logEval(evalCase, options.logger, `initializing git repo in ${cwd}`);
  await exec('git', ['init'], { cwd });
  logEval(evalCase, options.logger, `isolated repo ready at ${cwd}`);

  return {
    cwd,
    cleanup: async () => {
      await rm(cwd, { recursive: true, force: true });
    }
  };
}

export async function runSingleEval(evalCase: SkillEvalCase, options: RunSingleEvalOptions): Promise<SingleEvalResult> {
  const exec = options.exec ?? defaultExec;
  logEval(evalCase, options.logger, 'starting skill Pi run');
  const piEventsJsonl = await exec(
    'pi',
    piArgs({
      mode: 'json',
      model: options.model,
      thinking: options.thinking,
      skillPath: options.skillPath,
      prompt: evalCase.prompt
    }),
    {
      cwd: options.cwd,
      onStdoutLine: options.piEventLogger
    }
  );
  const { actualOutput } = parsePiJsonOutput(piEventsJsonl);
  logEval(evalCase, options.logger, 'skill Pi finished');
  const taskeyCommands = extractTaskeyCommandsFromPiEvents(piEventsJsonl);
  const taskeyState = await collectTaskeyState(options.cwd, exec);
  const judgePrompt = buildJudgePrompt({
    prompt: evalCase.prompt,
    expectedOutput: evalCase.expectedOutput,
    actualOutput,
    taskeyCommands,
    taskeyState
  });
  logEval(evalCase, options.logger, 'starting judge Pi run');
  const judgeOutput = await exec(
    'pi',
    piArgs({ model: options.model, thinking: options.thinking, prompt: judgePrompt }),
    {
      cwd: options.cwd
    }
  );
  logEval(evalCase, options.logger, 'judge Pi finished');

  return {
    eval: evalCase,
    actualOutput,
    piEventsJsonl,
    judgePrompt,
    grade: parseJudgeOutput(judgeOutput)
  };
}

export async function runEvalFile(options: RunnerOptions, cwd = process.cwd()): Promise<EvalRunSummary> {
  const logger = options.verbosity === 'quiet' ? undefined : createTimestampLogger();
  const piEventLogger = createPiEventLogger(options.verbosity, logger);
  logger?.(`loading evals from ${options.evalsPath}`);
  const evalFile = parseEvalFileContent(await readFile(options.evalsPath, 'utf8'));
  const evals = options.limit === undefined ? evalFile.evals : evalFile.evals.slice(0, options.limit);
  const results: SingleEvalResult[] = [];
  const skillPath = isAbsolute(options.skillPath) ? options.skillPath : resolve(cwd, options.skillPath);
  const repoRoot = options.repoPath === undefined ? cwd : resolve(cwd, options.repoPath);
  logger?.(`using repo ${repoRoot}`);
  logger?.(`using skill ${skillPath}`);

  for (const evalCase of evals) {
    const isolatedRepo = await prepareIsolatedEvalRepo(repoRoot, evalCase, { logger });
    try {
      results.push(
        await runSingleEval(evalCase, {
          skillPath,
          cwd: isolatedRepo.cwd,
          model: options.model,
          thinking: options.thinking,
          logger,
          piEventLogger
        })
      );
    } finally {
      logEval(evalCase, logger, `cleaning up isolated repo at ${isolatedRepo.cwd}`);
      await isolatedRepo.cleanup();
    }
  }

  return summarizeEvalRun(evalFile.skillName, results);
}

export async function persistEvalRunArtifacts(
  summary: EvalRunSummary,
  options: PersistEvalRunArtifactsOptions
): Promise<void> {
  await mkdir(options.outPath, { recursive: true });

  for (const result of summary.results) {
    const evalDir = join(options.outPath, `eval-${sanitizePathSegment(result.eval.id)}`);
    await mkdir(evalDir, { recursive: true });
    await writeFile(join(evalDir, 'prompt.txt'), result.eval.prompt);
    await writeFile(join(evalDir, 'actual.txt'), result.actualOutput);
    if (result.piEventsJsonl !== undefined) {
      await writeFile(join(evalDir, 'pi-events.jsonl'), result.piEventsJsonl);
    }
    await writeFile(join(evalDir, 'judge-prompt.txt'), result.judgePrompt);
    await writeFile(join(evalDir, 'grade.json'), `${JSON.stringify(result.grade, null, 2)}\n`);
  }

  const timestamp = options.timestamp ?? new Date().toISOString();
  await writeFile(
    join(options.outPath, 'summary.json'),
    `${JSON.stringify(toSummaryJson(summary, options.evalsPath, timestamp), null, 2)}\n`
  );
  await writeFile(join(options.outPath, 'summary.md'), toSummaryMarkdown(summary, options.evalsPath, timestamp));
}

export function summarizeEvalRun(skillName: string, results: SingleEvalResult[]): EvalRunSummary {
  const passed = results.filter((result) => result.grade.status === 'graded' && result.grade.passed).length;
  const gradeErrors = results.filter((result) => result.grade.status === 'grade_error').length;

  return {
    skillName,
    total: results.length,
    passed,
    failed: results.length - passed - gradeErrors,
    gradeErrors,
    results
  };
}

export function parsePiJsonOutput(jsonl: string): { actualOutput: string } {
  let finalAssistantText: string | undefined;
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const text = assistantTextFromEvent(event);
    if (text !== undefined) {
      finalAssistantText = text;
    }
  }

  return { actualOutput: finalAssistantText ?? jsonl };
}

async function collectTaskeyState(cwd: string, exec: ExecFunction): Promise<string | undefined> {
  try {
    const listOutput = await exec('taskey', ['{"action":"list"}'], { cwd });
    const listJson = JSON.parse(listOutput) as { ok?: boolean; tasks?: Array<{ id?: unknown }> };
    if (listJson.ok !== true || !Array.isArray(listJson.tasks)) {
      return listOutput;
    }

    const taskDetails: unknown[] = [];
    for (const task of listJson.tasks.slice(0, 20)) {
      if (typeof task?.id !== 'string') {
        continue;
      }
      try {
        const getOutput = await exec('taskey', [`{"action":"get","data":{"id":"${task.id}"}}`], { cwd });
        taskDetails.push(JSON.parse(getOutput));
      } catch {
        taskDetails.push({ ok: false, id: task.id, error: 'Failed to fetch task details.' });
      }
    }

    return JSON.stringify({ list: listJson, task_details: taskDetails }, null, 2);
  } catch {
    return undefined;
  }
}

function extractTaskeyCommandsFromPiEvents(jsonl: string): string[] {
  const commands: string[] = [];

  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }

    try {
      collectTaskeyCommandsFromEvent(JSON.parse(line), commands);
    } catch {}
  }

  return [...new Set(commands)];
}

function collectTaskeyCommandsFromEvent(event: unknown, commands: string[]): void {
  if (event === null || typeof event !== 'object') {
    return;
  }

  const record = event as Record<string, unknown>;
  const type = record.type;
  if (type !== 'turn_end' && type !== 'message_end') {
    return;
  }

  collectTaskeyCommandsFromValue(record.message, commands);
}

function collectTaskeyCommandsFromValue(value: unknown, commands: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTaskeyCommandsFromValue(item, commands);
    }
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  if (record.type === 'toolCall' && record.name === 'bash') {
    const argumentsValue = record.arguments;
    if (argumentsValue !== null && typeof argumentsValue === 'object') {
      const command = (argumentsValue as Record<string, unknown>).command;
      if (typeof command === 'string' && command.includes('taskey')) {
        commands.push(command);
      }
    }
  }

  for (const nested of Object.values(record)) {
    collectTaskeyCommandsFromValue(nested, commands);
  }
}

export function parseJudgeOutput(output: string): JudgeResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(output);
  } catch (error) {
    return gradeError(`Judge output was not valid JSON: ${errorMessage(error)}`);
  }

  const parsed = judgeSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return gradeError(`Judge output did not match judge schema: ${parsed.error.message}`);
  }

  return {
    status: 'graded',
    passed: parsed.data.passed,
    score: parsed.data.score,
    reason: parsed.data.reason,
    missing: parsed.data.missing
  };
}

function truncateForPrompt(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const omitted = value.length - maxLength;
  return `${value.slice(0, maxLength)}\n[truncated ${omitted} chars]`;
}

function createTimestampLogger(): Logger {
  return (message) => console.error(`[${new Date().toISOString()}] ${message}`);
}

function createPiEventLogger(verbosity: Verbosity, logger: Logger | undefined): ((line: string) => void) | undefined {
  if (logger === undefined || verbosity === 'quiet') {
    return undefined;
  }
  if (verbosity === 'full') {
    return (line) => logger(`[pi] ${line}`);
  }
  return () => process.stderr.write('.');
}

function logEval(evalCase: SkillEvalCase, logger: Logger | undefined, message: string): void {
  logger?.(`[eval ${evalCase.id}] ${message}`);
}

function toSummaryJson(summary: EvalRunSummary, evalsPath: string, timestamp: string) {
  return {
    skillName: summary.skillName,
    evalsPath,
    timestamp,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    gradeErrors: summary.gradeErrors,
    results: summary.results.map((result) => ({
      id: result.eval.id,
      status: resultStatus(result),
      score: result.grade.score,
      reason: result.grade.reason
    }))
  };
}

function toSummaryMarkdown(summary: EvalRunSummary, evalsPath: string, timestamp: string): string {
  const rows = summary.results
    .map(
      (result) =>
        `| ${result.eval.id} | ${resultStatus(result)} | ${result.grade.score} | ${escapeMarkdownCell(result.grade.reason)} |`
    )
    .join('\n');

  return `# Skill eval run: ${summary.skillName}

- Evals: \`${evalsPath}\`
- Timestamp: ${timestamp}
- Total: ${summary.total}
- Passed: ${summary.passed}
- Failed: ${summary.failed}
- Grade errors: ${summary.gradeErrors}

| Eval | Status | Score | Reason |
| --- | --- | ---: | --- |
${rows}
`;
}

function resultStatus(result: SingleEvalResult): 'passed' | 'failed' | 'grade_error' {
  if (result.grade.status === 'grade_error') {
    return 'grade_error';
  }
  return result.grade.passed ? 'passed' : 'failed';
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function shouldCopyPath(repoRoot: string, source: string): boolean {
  const relativePath = relative(repoRoot, source);
  if (relativePath === '') {
    return true;
  }

  const parts = relativePath.split(sep);
  if (parts[0] === '.git' || parts[0] === 'node_modules' || parts[0] === 'dist') {
    return false;
  }

  return !(parts[0] === 'skills' && parts[2] === 'evals' && parts[3] === 'runs');
}

function assistantTextFromEvent(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null || !('type' in event) || event.type !== 'message_end') {
    return undefined;
  }
  if (!('message' in event) || typeof event.message !== 'object' || event.message === null) {
    return undefined;
  }
  const message = event.message as { role?: unknown; content?: unknown };
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return undefined;
  }

  const text = message.content
    .flatMap((part) => {
      if (typeof part !== 'object' || part === null || !('type' in part) || part.type !== 'text') {
        return [];
      }
      return 'text' in part && typeof part.text === 'string' ? [part.text] : [];
    })
    .join('\n')
    .trim();

  return text === '' ? undefined : text;
}

function piArgs(input: {
  mode?: 'print' | 'json';
  model?: string;
  thinking?: string;
  skillPath?: string;
  prompt: string;
}): string[] {
  const args = input.mode === 'json' ? ['--mode', 'json'] : ['-p'];
  if (input.model !== undefined) {
    args.push('--model', input.model);
  }
  if (input.thinking !== undefined) {
    args.push('--thinking', input.thinking);
  }
  if (input.skillPath !== undefined) {
    args.push('--skill', input.skillPath);
  }
  args.push(input.prompt);
  return args;
}

export async function runCommandStreaming(command: string, args: string[], options: ExecOptions): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let pendingStdoutLine = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      pendingStdoutLine = emitCompleteLines(`${pendingStdoutLine}${chunk.toString('utf8')}`, options.onStdoutLine);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (pendingStdoutLine !== '') {
        options.onStdoutLine?.(pendingStdoutLine);
      }

      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trimEnd();
      if (code === 0) {
        resolvePromise(stdout);
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trimEnd();
      reject(new Error(`${command} exited with code ${code}${stderr === '' ? '' : `: ${stderr}`}`));
    });
  });
}

async function defaultExec(command: string, args: string[], options: ExecOptions): Promise<string> {
  return runCommandStreaming(command, args, options);
}

function emitCompleteLines(text: string, onLine: ((line: string) => void) | undefined): string {
  const lines = text.split(/\r?\n/);
  const pending = lines.pop() ?? '';
  for (const line of lines) {
    onLine?.(line);
  }
  return pending;
}

function deriveSkillPathFromEvalsPath(evalsPath: string): string {
  const suffix = '/evals/evals.json';
  return evalsPath.endsWith(suffix) ? evalsPath.slice(0, -suffix.length) : 'skills/taskey';
}

function parseVerbosity(value: string): Verbosity {
  if (value === 'quiet' || value === 'progress' || value === 'full') {
    return value;
  }
  throw new Error('--verbosity must be quiet, progress, or full');
}

function parseLimit(value: string): number {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('--limit must be a positive integer');
  }
  return limit;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function gradeError(reason: string): JudgeResult {
  return {
    status: 'grade_error',
    passed: false,
    score: 0,
    reason,
    missing: []
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
