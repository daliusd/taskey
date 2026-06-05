# @daliusd/taskey

JSON-first task management CLI for AI agents.

## Install and run

```sh
npm install -g @daliusd/taskey
taskey '{"action":"list"}'
echo '{"action":"next"}' | taskey
```

Install the agent skill with `npx skills`:

```sh
npx skills add https://github.com/daliusd/taskey --skill taskey
```

`taskey --help` and `taskey --version` are the only human-oriented modes. Normal output is compact JSON.

## Request format

```json
{"action":"create","data":{"title":"Write tests","description":"Use TDD","prerequisites":[]},"fields":["title","completed"]}
```

- Pass JSON either as one positional argument or via stdin.
- Do not pass both; that returns `AMBIGUOUS_INPUT`.
- Successful responses include `"ok": true`.
- Errors are JSON on stdout with non-zero exit code.

## Actions

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
taskey '{"action":"delete-all","data":{"confirm":true}}'
```

Success response:

```json
{"ok":true,"deleted":12}
```

## Field selection

For task-returning actions, `fields` may include:

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
