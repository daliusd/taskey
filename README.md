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
taskey stash --name sprint-cleanup
taskey stashes
taskey unstash --name sprint-cleanup
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
taskey list [--all] [--stash <name>]
taskey list-doable
taskey next
taskey get --id <task-id> [--stash <name>]
taskey create --title <title> [--description <text>] [--prerequisite <task-id> ...]
taskey update --id <task-id> [--title <title>] [--description <text>] [--prerequisite <task-id> ...] [--clear-prerequisites]
taskey complete --id <task-id>
taskey reopen --id <task-id>
taskey delete --id <task-id>
taskey delete-all
taskey stash --name <name>
taskey stashes
taskey unstash --name <name>
```

Notes:

- `taskey` and `taskey --help` show human help.
- `taskey list` shows incomplete active tasks only.
- `taskey list --all` shows active open tasks first, then blocked tasks, then completed tasks.
- `taskey next` shows the next unblocked active task with the same full details as `taskey get`.
- `taskey stash --name <name>` moves all active tasks for the current Git repo into a named inactive stash.
- `taskey stashes` lists stash names and task counts for the current Git repo.
- `taskey list --stash <name> [--all]` and `taskey get --id <task-id> --stash <name>` inspect a stash without making its tasks active.
- `taskey unstash --name <name>` moves that stash back to active tasks and removes the stash; active tasks must be empty first.
- `taskey delete-all` deletes active tasks for the current Git repo immediately. It does not delete stashes.

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
- `delete`: delete an active task unless other active tasks depend on it.
- `delete-all`: delete all active tasks for the current Git repo. Requires `data.confirm: true` and returns the deleted count.
- `stash`: move all active tasks into `data.name`, preserving IDs, completion state, prerequisites, and ordering.
- `stashes`: list named stashes for the current Git repo as `{name, taskCount}` objects.
- `unstash`: move `data.name` back to active tasks and remove the stash; active tasks must be empty.

`list` and `get` accept optional `data.stash` to read from a stash:

```sh
taskey json '{"action":"list","data":{"stash":"sprint-cleanup"}}'
taskey json '{"action":"get","data":{"id":"tsk_123","stash":"sprint-cleanup"}}'
```

Stash selectors are not supported on `next` or `list-doable`; stashed tasks are inactive.

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

Tasks and stash names are scoped to the current Git working tree root, resolved to a real path. Running outside a Git repository fails unless the undocumented test override `TASKEY_REPO_KEY` is set. Stashes use internal derived repo scopes; those internal keys are never shown in CLI or JSON output.

SQLite storage defaults to the OS user data directory:

- Linux: `$XDG_DATA_HOME/taskey/taskey.sqlite` or `~/.local/share/taskey/taskey.sqlite`
- macOS: `~/Library/Application Support/taskey/taskey.sqlite`
- Windows: `%APPDATA%/taskey/taskey.sqlite`

Use `TASKEY_DB_PATH=/path/to/taskey.sqlite` to override the database path, especially in tests.
