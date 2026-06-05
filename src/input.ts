import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TaskeyError } from './errors.js';

const MAX_INPUT_BYTES = 1024 * 1024;

const requestEnvelopeSchema = z
  .object({
    action: z.string(),
    data: z.unknown().optional(),
    fields: z.unknown().optional()
  })
  .strict();

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;

export function readRequest(argv: string[], stdinText = readStdin()): RequestEnvelope | 'help' | 'version' {
  if (argv.length === 1 && argv[0] === '--help') return 'help';
  if (argv.length === 1 && argv[0] === '--version') return 'version';

  if (argv.length > 1) {
    throw new TaskeyError('INVALID_ARGUMENTS', 'Expected exactly one JSON argument or stdin.');
  }

  const argInput = argv.length === 1 ? argv[0] : '';
  const stdinInput = stdinText.trim().length > 0 ? stdinText : '';

  if (argInput && stdinInput) {
    throw new TaskeyError('AMBIGUOUS_INPUT', 'Pass request JSON either as an argument or via stdin, not both.');
  }

  const input = argInput || stdinInput;
  if (!input) {
    throw new TaskeyError('MISSING_INPUT', 'Pass request JSON as an argument or via stdin.');
  }

  if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
    throw new TaskeyError('INVALID_ARGUMENTS', 'Input JSON must be at most 1 MiB.');
  }

  try {
    const parsed = JSON.parse(input) as unknown;
    const result = requestEnvelopeSchema.safeParse(parsed);
    if (!result.success) {
      throw new TaskeyError('INVALID_ARGUMENTS', 'Request must be a JSON object with string action.');
    }
    return result.data;
  } catch (error) {
    if (error instanceof TaskeyError) throw error;
    throw new TaskeyError('INVALID_JSON', 'Input must be valid JSON.');
  }
}

function readStdin(): string {
  if (process.stdin.isTTY) return '';
  return readFileSync(0, 'utf8');
}
