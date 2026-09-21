---
name: taskey
description: >-
  Use this skill whenever the user wants repository development work managed as persistent tasks: “break this work into tasks”, “make a plan/backlog/checklist”, “create handoff tasks for another coding agent”, “continue the next dev task”, “what’s the next unblocked task?”, “update/complete/reopen a task”, or “clear all tasks / start from scratch”. Use it even if the user does not mention taskey and even if implementation skills are also relevant, because the immediate job is task management. This skill uses the taskey JSON CLI to create, list, continue, update, complete, and delete repo-scoped dev tasks. Task descriptions capture what outcome is required, not how to implement it.
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
{"action":"create","data":{"title":"...","description":"## Outcome\n...\n\n## Requirements\n- ...\n\n## Acceptance criteria\n- ...","prerequisites":[]}}
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

Every task you create or update should be self-contained about the required result. Assume a different developer or AI agent may see only the task record, not the conversation that created it.

Task records define **what must be true when the work is complete**, while leaving the implementer free to decide how to achieve it. Include:

1. **Outcome** — the concrete result or changed behavior.
2. **Requirements** — user-visible behavior, required capabilities, compatibility expectations, explicit constraints, edge cases, and non-goals.
3. **Acceptance criteria** — observable conditions that establish completion.
4. **Prerequisites** — task IDs whose outcomes are required first.

Do not put implementation instructions in a task. In particular, do not prescribe:

- implementation steps or sequencing within the task;
- files, modules, functions, classes, or internal APIs to edit;
- architecture, algorithms, libraries, data structures, or design patterns;
- test strategy, test-file placement, validation commands, or manual verification procedure.

A detail remains appropriate when the user explicitly requires that detail as part of the result rather than as a suggested means of achieving it. Preserve externally observable contracts and user-stated constraints, but do not turn repository observations into implementation directions.

Prefer concise, outcome-focused descriptions. Do not create vague tasks such as "fix tests" or "implement API"; make the required behavior and completion conditions specific without explaining how to produce them.

## Recommended task description template

Use this structure for substantial tasks:

```markdown
## Outcome
[The specific result that must exist.]

## Requirements
- [Required behavior, constraint, edge case, or non-goal.]

## Acceptance criteria
- [Observable completion condition 1.]
- [Observable completion condition 2.]
```

For very small tasks, a shorter outcome statement is fine if completion is still unambiguous.

Bad stored description example (too vague):
- "Implement export command"

Bad stored description example (prescribes how):
- "Add `src/export.ts`, use Zod for serialization, and run `npm test`."

Good stored description example:
```markdown
## Outcome
The CLI can export its current task list as JSON.

## Requirements
- Exported data includes each task's title, description, completion state, and prerequisites.
- An empty task list produces a valid empty JSON collection.
- Existing commands retain their current behavior.

## Acceptance criteria
- A user can request an export and receive valid JSON representing all current tasks.
- Export output handles both populated and empty task lists.
```

Split work into multiple tasks only when each task delivers an independently required result. Do not manufacture method- or phase-oriented tasks such as "define the contract," "design the solution," "write tests," and "implement the code" unless the user explicitly requested those artifacts as separate outcomes. Planning, research, implementation, and validation are normally activities within delivery of an outcome, not task outcomes themselves.

## Planning workflow

When asked to plan development work:

1. Inspect the repository only enough to understand the requested outcomes, existing behavior, and genuine constraints.
2. Break the work into the fewest small tasks needed to represent independently required results and genuine outcome dependencies. Avoid decomposing work by implementation phase, technique, or engineering activity.
3. Write each description in terms of outcome, requirements, and observable acceptance criteria. Treat `description` as mandatory even though the CLI allows omitting it.
4. Remove proposed implementation choices from the description. Repository paths and internals discovered during inspection inform your planning but do not belong in the task unless they are explicit scope requirements from the user.
5. Identify outcome dependencies between tasks.
6. Create prerequisite tasks first so their IDs are available, then create dependent tasks with `prerequisites` set to those IDs.
7. Inspect created tasks when needed and immediately update any description that is vague or contains instructions about how to implement or validate the work.
8. Return a short summary of created tasks with IDs, required outcomes, acceptance criteria, and dependency order. Do not add implementation advice to the summary.

Example:

```sh
taskey json '{"action":"create","data":{"title":"Support JSON task export","description":"## Outcome\nThe CLI can export the current task list as JSON.\n\n## Requirements\n- Include task descriptions, completion state, and prerequisites.\n- Return a valid empty collection when no tasks exist.\n- Preserve existing command behavior.\n\n## Acceptance criteria\n- Export output is valid JSON representing every current task.\n- Populated and empty task lists are both supported.","prerequisites":[]}}'
```

Before creating or updating a task, check:
- Does it state a concrete required outcome?
- Are requirements expressed as behavior or constraints rather than implementation choices?
- Are acceptance criteria observable and solution-independent?
- Is all guidance about files, internals, tools, steps, and validation methods removed?
- Are prerequisites represented by task IDs rather than prose instructions?

If any answer is no, revise the description before storing it.

## Execution workflow

When asked to continue or implement work from the task list:

1. Run `taskey json '{"action":"next"}'`.
2. If `next` returns no task, run `taskey json '{"action":"list-doable"}'` as a second check before concluding nothing is available.
3. If no task is available from either command, stop there and tell the user there are no unblocked incomplete tasks. Do not infer a "next task" from the repository contents, README, TODO comments, or your own judgment. Do not implement anything in this branch, do not create a replacement task on your own, and do not suggest concrete implementation follow-up unless the user asks what to plan next.
4. If a task is returned, explicitly anchor your work to that task: mention the chosen task ID/title in your response, then read it carefully. If the required outcome is ambiguous, clarify it with the user or update the task with outcome-focused detail; do not add implementation instructions.
5. Implement only the task that Taskey returned, using normal development practices and any relevant project skills. The implementer chooses the approach after selecting the task; do not create a different "obvious" task and complete that instead.
6. Determine and run appropriate validation from the repository and the task's acceptance criteria. Validation belongs to execution, not to the stored task description.
7. Mark the task complete only after validation passes or the user explicitly accepts the result:

```sh
taskey json '{"action":"complete","data":{"id":"tsk_..."}}'
```

If implementation reveals new work, create new taskey tasks rather than burying follow-up work only in the chat.

## Updating tasks

Update a task when the required outcome or constraints change, acceptance criteria become clearer, or prerequisites need correction. Do not add implementation discoveries or validation procedures to the task:

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
  - Outcome: ...
  - Requirements: ...
  - Acceptance: ...
  - Prerequisites: none / `tsk_...`

Keep this summary outcome-focused too. Do not append suggestions about files, architecture, implementation steps, or validation commands.

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
