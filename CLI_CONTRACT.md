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
list [--all]
list-doable
next
get --id <task-id>
create --title <title> [--description <text>] [--prerequisite <task-id> ...]
update --id <task-id> [--title <title>] [--description <text>] [--prerequisite <task-id> ...] [--clear-prerequisites]
complete --id <task-id>
reopen --id <task-id>
delete --id <task-id>
delete-all
json
```

Human output is plain text on stdout. Human errors are plain text on stderr with non-zero exit status.

Behavior notes:

- `taskey` with no args is the same as `taskey --help`.
- `taskey list` shows incomplete tasks only.
- `taskey list --all` orders tasks as open, blocked, then done.
- `taskey next` shows the next unblocked task using the same full-detail human view as `taskey get`.
- `taskey next` prints a friendly message and exits `0` when no unblocked task exists.
- `taskey delete-all` runs immediately with no extra `--yes` flag.

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
- `list`: returns all current-repository tasks.
- `list-doable`: returns incomplete tasks whose prerequisites are all completed.
- `next`: returns first `list-doable` task or `null`.
- `update`: `data.id` plus at least one of `title`, `description`, `prerequisites`.
- `complete`: `data.id` required.
- `reopen`: `data.id` required.
- `delete`: `data.id` required; `fields` rejected.
- `delete-all`: `data.confirm` must be `true`; deletes all tasks for the current Git repository; `fields` rejected.

## Machine output

Success examples:

```json
{"ok":true,"tasks":[]}
{"ok":true,"task":null}
{"ok":true,"deleted":true,"id":"tsk_abc"}
{"ok":true,"deleted":12}
```

Error example:

```json
{"ok":false,"error":{"code":"INVALID_JSON","message":"Input must be valid JSON."}}
```

Machine JSON errors are printed to stdout with non-zero exit code. Stderr is empty by default.

## Git scoping

Every task operation is scoped to the current Git working tree root resolved via realpath. Running outside a Git repository returns `NOT_GIT_REPOSITORY`.
