#!/usr/bin/env tsx
import { parseRunnerArgs, persistEvalRunArtifacts, runEvalFile } from '../src/evalRunner.js';

async function main() {
  const options = parseRunnerArgs(process.argv.slice(2));
  const outputDir =
    options.outPath ?? `${options.skillPath}/evals/runs/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const summary = await runEvalFile(options);
  if (options.verbosity !== 'quiet') {
    console.error(`[${new Date().toISOString()}] writing artifacts to ${outputDir}`);
  }
  await persistEvalRunArtifacts(summary, {
    outPath: outputDir,
    evalsPath: options.evalsPath
  });
  if (options.verbosity !== 'quiet') {
    console.error(`[${new Date().toISOString()}] artifacts written`);
  }

  console.log(`Skill evals for ${summary.skillName}`);
  console.log(`Output dir: ${outputDir}`);
  console.log(`Total: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Grade errors: ${summary.gradeErrors}`);

  for (const result of summary.results) {
    const grade = result.grade;
    const status = grade.status === 'grade_error' ? 'GRADE_ERROR' : grade.passed ? 'PASS' : 'FAIL';
    console.log(`- ${result.eval.id}: ${status} (${grade.score}) ${grade.reason}`);
  }

  if (summary.failed > 0 || summary.gradeErrors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
