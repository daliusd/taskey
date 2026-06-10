# Taskey CLI Contract

`taskey` is a human-first CLI with an explicit machine JSON mode.

## Human mode

Top-level commands are human-friendly:

```sh
taskey list
taskey get --id tsk_123
taskey delete-all
taskey --help
```

Command set:

```text
list [--all] [--stash <name>]
list-doable
next
get --id <task-id> [--stash <name>]
create --title <title> [--description <text>] [--prerequisite <task-id> ...]
update --id <task-id> [--title <title>] [--description <text>] [--prerequisite <task-id> ...] [--clear-prerequisites]
complete --id <task-id>
reopen --id <task-id>
delete --id <task-id>
delete-all
stash --name <name>
stashes
unstash --name <name>
json
```

Human output is plain text on stdout. Human errors are plain text on stderr with non-zero exit status.

Behavior notes:

- `taskey` with no args is the same as `taskey --help`.
- `taskey list` shows incomplete active tasks only.
- `taskey list --all` orders active tasks as open, blocked, then done.
- `taskey list --stash <name> [--all]` uses the same list formatting for tasks inside a stash.
- `taskey get --id <task-id> --stash <name>` reads a task from a stash.
- `taskey next` shows the next unblocked active task using the same full-detail human view as `taskey get`.
- `taskey next` prints a friendly message and exits `0` when no unblocked task exists.
- `taskey delete-all` runs immediately with no extra `--yes` flag and deletes active tasks only, not stashes.
- `taskey stash --name <name>` moves all active tasks into a named inactive stash; it rejects empty active sets and duplicate stash names.
- `taskey stashes` lists stash names and task counts.
- `taskey unstash --name <name>` moves a stash back to active tasks and removes the stash; active tasks must be empty first.

## Machine JSON mode

Run machine mode through the `json` subcommand.

```sh
taskey json '{"action":"list"}'
echo '{"action":"list"}' | taskey json
```

Pass exactly one JSON request either as one positional argument or via stdin.

Providing both argument JSON and stdin JSON is an `AMBIGUOUS_INPUT` error. Providing no JSON is `MISSING_INPUT`. More than one positional JSON argument is `INVALID_ARGUMENTS`.

On an interactive TTY, `taskey json` with no JSON input may show a short usage message instead of a JSON error.

## Request envelope

```json
{
  "action": "create",
  "data": {},
  "fields": ["title", "description", "prerequisites", "completed"]
}
```

- `action` is required.
- `data` is action-specific.
- `fields` is allowed only on actions returning task objects: `create`, `get`, `list`, `list-doable`, `next`, `update`, `complete`, `reopen`.
- `fields` may contain `title`, `description`, `prerequisites`, and `completed`; `id` is always returned.
- Unknown fields are rejected.

## Machine actions

- `create`: `data.title` required; `data.description` optional; `data.prerequisites` optional.
- `get`: `data.id` required.
- `list`: returns all active current-repository tasks. Optional `data.stash` returns all tasks in that stash instead.
- `list-doable`: returns incomplete active tasks whose prerequisites are all completed. `data` is rejected.
- `next`: returns first active `list-doable` task or `null`. `data` is rejected.
- `update`: `data.id` plus at least one of `title`, `description`, `prerequisites`.
- `complete`: `data.id` required.
- `reopen`: `data.id` required.
- `delete`: `data.id` required; deletes an active task; `fields` rejected.
- `delete-all`: `data.confirm` must be `true`; deletes all active tasks for the current Git repository; stashes are preserved; `fields` rejected.
- `stash`: `data.name` required; moves all active tasks into that stash and returns `{stash:{name,taskCount}}`; `fields` rejected.
- `stashes`: returns `{stashes:[{name,taskCount}]}` for the current Git repository; `data` and `fields` rejected.
- `unstash`: `data.name` required; active tasks must be empty; moves the stash back to active tasks, removes the stash, and returns `{stash:{name,taskCount}}`; `fields` rejected.

`get` accepts optional `data.stash`:

```json
{"action":"get","data":{"id":"tsk_123","stash":"sprint-cleanup"}}
```

Stash names are trimmed, non-empty, at most 100 characters, and may contain letters, numbers, spaces, `_`, `-`, and `.`.

## Machine output

Success examples:

```json
{"ok":true,"tasks":[]}
{"ok":true,"task":null}
{"ok":true,"deleted":true,"id":"tsk_abc"}
{"ok":true,"deleted":12}
{"ok":true,"stash":{"name":"sprint-cleanup","taskCount":4}}
{"ok":true,"stashes":[{"name":"sprint-cleanup","taskCount":4}]}
```

Error example:

```json
{"ok":false,"error":{"code":"INVALID_JSON","message":"Input must be valid JSON."}}
```

Machine JSON errors are printed to stdout with non-zero exit code. Stderr is empty by default.

## Git scoping

Every active task operation is scoped to the current Git working tree root resolved via realpath. Running outside a Git repository returns `NOT_GIT_REPOSITORY`. Stashes are also scoped per Git repository and implemented with internal derived repo keys; those keys are not exposed in human or JSON output.
