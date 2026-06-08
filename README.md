# @daliusd/taskey

Task management CLI scoped to the current Git repository.

## Install and run

```sh
npm install -g @daliusd/taskey
```

Human-friendly CLI:

```sh
taskey list
taskey create --title "Add CLI help"
taskey get --id tsk_123
taskey delete-all
```

Machine JSON mode:

```sh
taskey json '{"action":"list"}'
echo '{"action":"next"}' | taskey json
```

Install the agent skill with `npx skills`:

```sh
npx skills add https://github.com/daliusd/taskey --skill taskey
```

## Human commands

```text
taskey list [--all]
taskey list-doable
taskey next
taskey get --id <task-id>
taskey create --title <title> [--description <text>] [--prerequisite <task-id> ...]
taskey update --id <task-id> [--title <title>] [--description <text>] [--prerequisite <task-id> ...] [--clear-prerequisites]
taskey complete --id <task-id>
taskey reopen --id <task-id>
taskey delete --id <task-id>
taskey delete-all
```

Notes:

- `taskey` and `taskey --help` show human help.
- `taskey list` shows incomplete tasks only.
- `taskey list --all` shows open tasks first, then blocked tasks, then completed tasks.
- `taskey next` shows the next unblocked task with the same full details as `taskey get`.
- `taskey delete-all` deletes all tasks for the current Git repo immediately.

## Machine JSON mode

Request envelope:

```json
{"action":"create","data":{"title":"Write tests","description":"Use TDD","prerequisites":[]},"fields":["title","completed"]}
```

- Run JSON mode as `taskey json ...`.
- Pass JSON either as one positional argument or via stdin.
- Do not pass both; that returns `AMBIGUOUS_INPUT`.
- Successful responses include `"ok": true`.
- Errors are JSON on stdout with non-zero exit code.

Actions:

- `create`: create a task. `title` is required; `description` defaults to `""`; `prerequisites` defaults to `[]`.
- `get`: fetch one task by `id`.
- `list`: list all tasks for the current Git repo.
- `list-doable`: list incomplete tasks whose prerequisites are completed.
- `next`: first doable task, or `null`.
- `update`: partial update of `title`, `description`, and/or full replacement `prerequisites`.
- `complete`: mark a task completed.
- `reopen`: mark a task incomplete.
- `delete`: delete a task unless other tasks depend on it.
- `delete-all`: delete all tasks for the current Git repo. Requires `data.confirm: true` and returns the deleted count.

Example destructive cleanup:

```sh
taskey json '{"action":"delete-all","data":{"confirm":true}}'
```

Success response:

```json
{"ok":true,"deleted":12}
```

## Field selection

For task-returning machine actions, `fields` may include:

- `title`
- `description`
- `prerequisites`
- `completed`

`id` is always returned. If `fields` is omitted, all public task fields are returned.

## Storage and Git scope

Tasks are scoped to the current Git working tree root, resolved to a real path. Running outside a Git repository fails unless the undocumented test override `TASKEY_REPO_KEY` is set.

SQLite storage defaults to the OS user data directory:

- Linux: `$XDG_DATA_HOME/taskey/taskey.sqlite` or `~/.local/share/taskey/taskey.sqlite`
- macOS: `~/Library/Application Support/taskey/taskey.sqlite`
- Windows: `%APPDATA%/taskey/taskey.sqlite`

Use `TASKEY_DB_PATH=/path/to/taskey.sqlite` to override the database path, especially in tests.
