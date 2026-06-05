# Taskey CLI Contract

`taskey` is a machine-first CLI. Normal input and output are JSON.

## Input

Pass exactly one JSON request either as one positional argument or via stdin.

```sh
taskey '{"action":"list"}'
echo '{"action":"list"}' | taskey
```

Providing both argument JSON and stdin JSON is an `AMBIGUOUS_INPUT` error. Providing no JSON is `MISSING_INPUT`. More than one positional argument is `INVALID_ARGUMENTS`.

Special human commands:

```sh
taskey --help
taskey --version
```

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

## Actions

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

## Output

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

JSON errors are printed to stdout with non-zero exit code. Stderr is empty by default.

## Git scoping

Every task operation is scoped to the current Git working tree root resolved via realpath. Running outside a Git repository returns `NOT_GIT_REPOSITORY`.
