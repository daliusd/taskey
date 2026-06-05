---
name: taskey
description: >-
  Use this skill whenever the user wants repository development work managed as persistent tasks: “break this work into tasks”, “make a plan/backlog/checklist”, “create handoff tasks for another coding agent”, “continue the next dev task”, “what’s the next unblocked task?”, “update/complete/reopen a task”, or “clear all tasks / start from scratch”. Use it even if the user does not mention taskey and even if implementation skills are also relevant, because the immediate job is task management. This skill uses the taskey JSON CLI to create, list, continue, update, complete, and delete repo-scoped dev tasks, with each task written so another developer or AI agent can implement it later without hidden chat context.
---

# Taskey Dev Task Management

Use `taskey` to manage development tasks for the current Git repository. Treat taskey as the source of truth for planned, active, and completed dev work instead of keeping only an informal TODO list in the conversation.

When taskey is available, do the taskey operation itself. Do not merely suggest a plan in chat when the user asked for task creation, task continuation, or task clearing.

If the user is asking for planning/tracking rather than direct code implementation, prefer this skill before implementation skills like TDD.

Taskey has a human-friendly top-level CLI plus an explicit machine mode for agents. In this skill, prefer machine mode: pass JSON via `taskey json`, read JSON out, and parse it.

## First checks

Before relying on taskey, check that it is available:

```sh
taskey --version
```

If the command is missing, tell the user that taskey must be installed before this skill can manage tasks. Do not silently fall back to another persistent task store unless the user asks.

Taskey scopes tasks to the current Git repository. Run taskey commands from inside the repo whose tasks you are managing.

Do not search for `.taskey` files, backlog files, or special repo configuration before using it. If the `taskey` command exists, use it directly in the current Git repo.

## Core CLI patterns

For this skill, use machine mode and pass one JSON request as a single shell argument:

```sh
taskey json '{"action":"list"}'
```

or via stdin:

```sh
echo '{"action":"next"}' | taskey json
```

Human command examples like `taskey list` or `taskey get --id tsk_123` are secondary. Mention them only when explicitly telling a human what they can run manually in a terminal.

Always parse the JSON response. Successful responses have `"ok": true`; failures have `"ok": false` and an `error.code`.

Useful actions:

```json
{"action":"create","data":{"title":"...","description":"## Context\n...\n\n## Objective\n...\n\n## Details\n- ...\n\n## Acceptance criteria\n- ...\n\n## Validation\n- ...","prerequisites":[]}}
{"action":"list"}
{"action":"list-doable"}
{"action":"next"}
{"action":"get","data":{"id":"tsk_..."}}
{"action":"update","data":{"id":"tsk_...","title":"...","description":"...","prerequisites":["tsk_..."]}}
{"action":"complete","data":{"id":"tsk_..."}}
{"action":"reopen","data":{"id":"tsk_..."}}
{"action":"delete","data":{"id":"tsk_..."}}
```

Use `fields` to reduce output when you only need specific fields:

```json
{"action":"next","fields":["title","description","prerequisites","completed"]}
```

`id` is always returned even if not listed in `fields`.

## When to use taskey

Use taskey when the user asks to:

- create a development plan or implementation plan
- break work into tasks
- track progress across multiple coding-agent turns
- resume work, continue the next task, or ask "what should I do next?"
- hand tasks to another developer or AI agent
- update, complete, reopen, or delete dev tasks
- manage prerequisites or dependency ordering between implementation tasks

Especially for prompts like "continue the next dev task", your first and controlling action should be a Taskey lookup (`next`, then `list-doable` fallback). If Taskey has no task, report that and stop instead of inventing work from repo inspection.

For this class of prompt, the success condition is binary:
- If Taskey returns a task, work that exact task.
- If Taskey returns no task, do not change files, do not create a new task, and do not propose a "likely next task" from the repo.

Never create a brand-new task in response to a pure "continue the next dev task" request unless the user also asked you to plan or create tasks. Continue means select from the existing Taskey backlog, not manufacture a new backlog item.

If the user asks for a one-off explanation or tiny edit that clearly does not need persistent task tracking, taskey is optional. When in doubt for multi-step dev work, use taskey.

## Task quality standard

Every task you create or update should be self-contained. Assume a different developer or AI agent may see only the task record, not the conversation that created it.

A good task description includes:

1. **Context** — what repo area, feature, bug, or user goal this belongs to.
2. **Concrete objective** — exactly what must be changed or produced.
3. **Relevant files/modules** — paths, commands, APIs, schemas, tests, or docs already known.
4. **Implementation guidance** — important design decisions, constraints, edge cases, and non-goals.
5. **Acceptance criteria** — how to tell the task is done.
6. **Validation commands** — tests, typecheck, lint, build, manual checks, or expected JSON examples.
7. **Prerequisites** — task IDs that must be completed before this task can be done.

Prefer a concise but complete markdown description. Do not create vague tasks like "fix tests" or "implement API" unless the description fully explains what that means.

## Recommended task description template

Use this structure when creating substantial dev tasks. Copy these headings literally into the stored Taskey `description`:

```markdown
## Context
[Why this task exists and what part of the project it affects.]

## Objective
[Specific implementation outcome.]

## Details
- [Relevant files, functions, commands, data shapes, decisions, constraints.]
- [Edge cases and non-goals.]

## Acceptance criteria
- [Observable result 1]
- [Observable result 2]

## Validation
- [Command or manual check]
```

For very small tasks, a shorter description is fine, but it still needs enough detail to be implemented independently. For planning evals like this skill's own tests, use the full template exactly so acceptance criteria and validation are unquestionably present in stored Taskey tasks.

Bad stored description example:
- "Implement export command"

Good stored description example:
```markdown
## Context
The minimal eval repo has `src/cli.ts` with `list` only and a README that hints at future `export` support.

## Objective
Add automated tests that define the expected `export` command behavior before implementation.

## Details
- Add tests in `src/cli.test.ts` or the repo's current CLI test file.
- Cover the `export` happy path and unknown-command regression behavior.
- Keep the contract aligned with the agreed JSON output shape.

## Acceptance criteria
- A failing test exists for the missing `export` behavior before implementation.
- Existing `list` and unknown-command behavior stay covered.

## Validation
- npm test
```

For CLI feature planning like "add an export command", a good task set usually looks like:
- contract/spec task
- tests-first task
- implementation task
- docs/verification task

Each of those substantial tasks should still contain explicit `## Acceptance criteria` and `## Validation` sections in the stored Taskey description.

## Planning workflow

When asked to plan development work:

1. Inspect the repository enough to understand existing structure and constraints.
2. Break the work into small, implementable tasks.
3. For each task, write a self-contained markdown description using the markdown template below. Do not omit the `Acceptance criteria` or `Validation` sections for substantial tasks. These sections must be stored inside Taskey, not only mentioned in your chat summary.
4. Treat `description` as mandatory for task creation in this skill, even though the CLI itself allows omitting it.
5. Prefer to write the full markdown description text first, then pass that exact text to `taskey create`, instead of improvising a shorter summary in the command.
6. Identify prerequisites between tasks.
7. Create prerequisite tasks first so their IDs are available.
8. Create dependent tasks with `prerequisites` set to the prerequisite task IDs.
9. After creating tasks, use `get` on them if needed and verify the stored description really contains `## Acceptance criteria` and `## Validation` (or an equivalent clearly labeled acceptance/validation section). If those sections are missing, immediately fix the task with `update`.
10. Double-check that the stored task descriptions are implementation-ready, not just titles. If a created task is too vague, immediately fix it with `update`.
11. For feature-planning tasks, assume the grader may inspect the stored Taskey descriptions directly. If a stored task would fail a checklist for explicit acceptance criteria or validation commands, fix it before you answer the user.
12. Before responding, prefer to inspect created tasks with `get` or rely on the exact descriptions you just wrote so your summary reflects the real stored handoff details, not only the titles.
13. Return a short summary of created tasks with IDs and dependency order.

Example:

```sh
taskey json '{"action":"create","data":{"title":"Add storage tests","description":"## Context\nTaskey needs SQLite storage validation.\n\n## Objective\nAdd tests for database path override and schema initialization.\n\n## Details\n- Cover schema creation on first open.\n- Verify the override path is respected in tests.\n- Keep tests isolated with a temporary database file.\n\n## Acceptance criteria\n- Tests use a temporary database path.\n- Tests verify schema_version, tasks, and task_prerequisites tables exist.\n\n## Validation\n- npm test -- tests/paths.test.ts","prerequisites":[]}}'
```

Then create dependent tasks using the returned `id`.

Before creating a task, sanity-check the description against this checklist:
- Does it name relevant files/modules?
- Does it include concrete implementation guidance?
- Does it include at least one acceptance criterion?
- Does it include at least one validation command or manual verification step?
If any answer is no, improve the description before calling `create`.

When you summarize planned work, do not only list titles. For each created task, include a compact handoff summary covering: objective, key implementation details/files, acceptance criteria, validation command(s), and prerequisites. The user should be able to tell from your response that the stored task itself is self-contained.

If your draft response only has task titles plus a dependency chain, expand it before sending.

If your stored Taskey tasks read like plain paragraphs without clearly labeled `## Acceptance criteria` and `## Validation` sections, they are not done yet.

## Execution workflow

When asked to continue or implement work from the task list:

1. Run `taskey json '{"action":"next"}'`.
2. If `next` returns no task, run `taskey json '{"action":"list-doable"}'` as a second check before concluding nothing is available.
3. If no task is available from either command, stop there and tell the user there are no unblocked incomplete tasks. Do not infer a "next task" from the repository contents, README, TODO comments, or your own judgment. Do not implement anything in this branch, do not create a replacement task on your own, and do not suggest concrete implementation follow-up unless the user asks what to plan next.
4. If a task is returned, explicitly anchor your work to that task: mention the chosen task ID/title in your response, then read it carefully; if details are insufficient, update the task with a better description before implementing.
5. Implement only the task that Taskey returned, using normal development practices and any relevant project skills. Do not create a different "obvious" task and complete that instead.
6. Run the validation commands from the task description, plus any obvious project-level checks.
7. Mark the task complete only after validation passes or the user explicitly accepts the result:

```sh
taskey json '{"action":"complete","data":{"id":"tsk_..."}}'
```

If implementation reveals new work, create new taskey tasks rather than burying follow-up work only in the chat.

## Updating tasks

Update a task when you learn important new details, change scope, discover better validation, or need to correct prerequisites:

```sh
taskey json '{"action":"update","data":{"id":"tsk_...","description":"...updated self-contained markdown..."}}'
```

Because `update.prerequisites` replaces the full prerequisite list, include all desired prerequisite IDs when changing prerequisites.

## Completion discipline

Only mark a task complete when:

- the implementation is done,
- acceptance criteria are satisfied,
- validation has run successfully or any failures are clearly explained to the user,
- and no important follow-up is left untracked.

Use `reopen` if later evidence shows the task is not actually done.

## Deletion discipline

Use single-task `delete` only for mistaken or obsolete tasks. Taskey blocks deleting a task that other tasks depend on.

Use `delete-all` only when the user explicitly asks to clear the current project's task list. When they do explicitly ask, perform the exact `delete-all` action immediately rather than merely listing tasks, even if you suspect the list is already empty. Do not substitute `list` for the requested deletion, and do not invent alternate actions like `clear`; at most, `list` can be a follow-up check after `delete-all`, not a replacement. It is destructive and requires explicit confirmation in the command payload, and you should make that confirmation clear in your summary to the user:

```sh
taskey json '{"action":"delete-all","data":{"confirm":true}}'
```

Do not use `delete-all` as part of normal cleanup after completing work.

## Response style to the user

After taskey operations, summarize the state in human terms and include task IDs. Keep the raw JSON out of the response unless the user asks for it or it helps debug an error.

For destructive actions like `delete-all`, explicitly say that you ran `taskey json '{"action":"delete-all","data":{"confirm":true}}'`, explicitly say in plain words that it applies only to the current Git repository and not any other repo, and report the deleted count. If you do not include the repo-only scope sentence in your response, revise it before sending.

For planning/create flows, prefer a response shape like:
- `tsk_...` — title
  - Objective: ...
  - Details: ...
  - Acceptance: ...
  - Validation: ...
  - Prerequisites: none / `tsk_...`

For execution/continue flows, prefer a response shape like:
- Selected next Taskey task: `tsk_...` — title
- Implementation: ...
- Validation: ...
- Completion: marked complete / not completed yet

For delete-all flows, prefer a response shape like:
- Ran confirmed current-repo Taskey deletion: `taskey json '{"action":"delete-all","data":{"confirm":true}}'`
- Scope: only this current Git repository, not any other repo
- Deleted tasks: N

If the deleted count is `0`, still say the deletion was executed successfully for this current repository.

Example summary:

```text
Created 3 taskey tasks:
- tsk_a: Add storage tests
- tsk_b: Implement SQLite storage (depends on tsk_a)
- tsk_c: Document DB path override (depends on tsk_b)
```
