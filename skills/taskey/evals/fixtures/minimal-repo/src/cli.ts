export function runCli(args: string[]): string {
  const [command] = args;

  if (command === 'list') {
    return JSON.stringify({ ok: true, tasks: [] });
  }

  return JSON.stringify({ ok: false, error: { code: 'UNKNOWN_COMMAND' } });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(runCli(process.argv.slice(2)));
}
