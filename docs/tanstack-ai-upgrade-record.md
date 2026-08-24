# TanStack AI upgrade record: 0.10.3 → 0.47.1

This is the completed record of bumping `@tanstack/ai` and `@tanstack/ai-ollama` across a 37-minor gap, migrating the resulting type errors, and live-verifying the runtime behavior no static check can see. It supersedes any narrower notes in commit messages — those are accurate but scattered; this is the consolidated version for anyone touching the AI layer next.

## Version table

| Package | Before | After | Minors crossed |
|---|---|---|---|
| `@tanstack/ai` | `^0.10.3` | `0.47.1` (exact) | 37 |
| `@tanstack/ai-ollama` | `^0.6.6` | `0.9.3` (exact) | 3 |

For comparison, the TanStack router/Start family in this same repo, already exact-pinned throughout, had drifted only **2 minors** before this branch bumped it. See [ADR 0010](./adr/0010-exact-pins-for-pre-1.0-dependencies.md).

## Root cause of the drift

Both packages carried a caret (`^0.10.3`, `^0.6.6`). On a `0.x.y` version, npm/yarn's semver caret only allows patch-level movement — `^0.10.3` resolves to `>=0.10.3 <0.11.0`. Every `yarn install` kept silently re-resolving the same 0.10.x line; `0.11.0` and every version after it never satisfied the range, and nothing about a normal install run signals that. The caret looked like an ordinary "stay current" specifier; it was actually a ceiling frozen at whatever minor happened to be installed first, with no error, no warning, and no lockfile anomaly to notice.

The router family, pinned exactly the whole time, had its literal old version number sitting in `package.json` in plain view — which is what eventually prompted its (much smaller) manual bump. The caret's silence is the specific mechanism that let the AI family run 37 minors past that before anyone looked.

Both packages are now exact-pinned, closing this specific hole for these two dependencies. See ADR 0010 for the general rule.

## Type errors from the bump (Task 8, Step 3)

`cd client && npx tsc --noEmit` after the version bump, before any code changes: **exit 2, exactly 11 errors**, all the same root cause, all `TS2353`:

```
src/lib/services/digest.ts(345,11): error TS2353: Object literal may only specify known properties, and 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, ZodObject<...>...'.
src/lib/services/digest.ts(476,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, false, readonly (...)[] | undefined, [], unknown, undefined>'.
src/lib/services/learning.ts(520,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, ZodObject<...>...'.
src/lib/services/learning.ts(716,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, ZodObject<...>...'.
src/lib/services/learning.ts(1530,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, ZodObject<...>...'.
src/lib/services/notes.ts(292,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, false, readonly (...)[] | undefined, [], unknown, undefined>'.
src/lib/services/reader.ts(173,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, false, readonly (...)[] | undefined, [], unknown, undefined>'.
src/lib/services/reader.ts(235,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, false, readonly (...)[] | undefined, [], unknown, undefined>'.
src/lib/services/reader.ts(291,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, false, readonly (...)[] | undefined, [], unknown, undefined>'.
src/routes/api.ask.tsx(148,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, boolean, ((ServerTool<...> & ...>'.
src/routes/api.notes.compose.tsx(198,11): error TS2353: ... 'temperature' does not exist in type 'TextActivityOptionsWithContext<OllamaTextAdapter<string>, undefined, boolean, readonly (...)[] | undefined, [], unknown, undefined>'.
```

All 11 are the same cause: top-level `temperature` was removed from `chat()`'s options in 0.47.1 — confirmed against `TextOptions` in the installed `@tanstack/ai` typings, which lists `systemPrompts`, `agentLoopStrategy`, `lazyToolsConfig`, `metadata`, `modelOptions`, `request`, `outputSchema`, `threadId`, and no `temperature`. No error outside this family appeared. This matched the plan's prediction exactly (Task 8's brief anticipated "roughly 11 errors of the form … 'temperature' does not exist").

## The real `modelOptions` shape — and why the plan's example is wrong

Both the modernization plan and Task 9's brief give this illustrative fix:

```ts
modelOptions: { temperature: 0.3 },
```

**This does not typecheck anywhere in yt-kb.** The shape that actually typechecks, at all 11 sites, is:

```ts
modelOptions: { model: SUMMARY_MODEL, options: { temperature: 0.3 } },
```

Root cause, traced through the installed `.d.ts` files rather than guessed:

- `OllamaTextAdapter<TModel>` resolves its provider-options type via `ResolveModelOptions<TModel> = TModel extends keyof OllamaChatModelOptionsByName ? OllamaChatModelOptionsByName[TModel] : ChatRequest`.
- Every yt-kb call site passes a **dynamic (non-literal) model string** into `createOllamaChat` — `SUMMARY_MODEL`, `CHAT_MODEL`, `MODEL`, `OLLAMA_MODEL` are all `readEnv(...) ?? default`, typed as the widened `string`. A widened `string` never extends the literal-key union `OllamaChatModelOptionsByName`, so the conditional falls to the `ChatRequest` branch.
- That `ChatRequest` is imported straight from the `ollama` npm package, where `model` is a **required** field and `temperature` only exists nested inside `options: Partial<Options>`.
- The package's own shipped skill (`@tanstack/ai/skills/ai-core/adapter-configuration/SKILL.md`) uses a **literal** model string (`ollamaText('llama3.3')`) in its example, which resolves through the *other* branch — the per-model type, which has no required `model` field. That's why the skill's own sample code omits `model` and doesn't need it; it's exercising a code path yt-kb's dynamic-model call sites never hit. **The skill's own example misleads for any codebase that reads the model from an env var, which is the common case.**
- Runtime is unaffected either way: the compiled adapter (`@tanstack/ai-ollama/dist/esm/adapters/text.js`, `mapCommonOptionsToOllama`) takes `model` from the top-level engine-populated value bound to the adapter instance, never from `modelOptions.model`. So `modelOptions.model` is inert at runtime — required by the type, ignored by the implementation. It's included at every site with a comment recording why, so a future reader doesn't wonder why the model is named twice.

This was independently corroborated by the Task 8 code reviewer, who traced the same two files (`ai-ollama/dist/esm/adapters/text.js` and `ai/dist/esm/activities/chat/index.js`) and confirmed both claims (temperature reaches Ollama; `modelOptions.model` is never read) against the compiled source, not just the typings.

## Which of the six predicted risk areas actually applied

The modernization spec (`docs/superpowers/specs/2026-08-22-modernize-from-music-kb-design.md`, Phase 3) carried six risk areas forward from music-kb's own TanStack AI upgrade playbook. Three were confirmed by direct code reading before any migration work started; the other three were only resolvable by driving real traffic through a live stack (Task 10):

| # | Risk area | Applied? | Evidence |
|---|---|---|---|
| 1 | `createOllamaChat` construction reorganized | **No** | Signature unchanged at 0.9.3: `createOllamaChat<TModel extends string>(model: TModel, hostOrConfig?): OllamaTextAdapter<TModel>`. All 8 call sites untouched. |
| 2 | Top-level `temperature` removed, moved to `modelOptions` | **Yes** | The 11 `TS2353` errors above. Real shape required `model` too — see previous section. |
| 3 | `systemPrompts` workaround now conflicts with the real option | **Yes** | Two sites (`api.chat.tsx`, `learning.ts`) prepended a `{ role: 'system' }` message and cast `messages ... as never` because `ai-ollama@0.6.6` silently dropped `systemPrompts`. Confirmed `systemPrompts?: Array<SystemPrompt>` exists and is honored at 0.9.3; both workarounds removed in Task 9, both casts gone. |
| 4 | `TOOL_CALL_END` fires twice per tool call (once for input, once for output) | **No** | Live-captured traffic (Task 10) showed `TOOL_CALL_END` fires **exactly once**, carrying only the input. What actually changed instead: the *result* now arrives on a **separate** `TOOL_CALL_RESULT` event, keyed only by `toolCallId` — a different shape than "duplicate END", not the predicted one. |
| 5 | Structured-output workaround (`coerceStrictSchema`) conflicts with new native structured-output semantics | **No** | Live regenerate (Task 10) parsed cleanly against `SummarySchema` with no workaround needed; `valueScore`/`signalScore`/`finalScore` all written correctly, timecodes grounded. |
| 6 | Shipped skill docs are the more reliable reference for migration ("Common Mistakes" section) | **Partially** | Reading the skill *before* fixing (per Task 8, Step 4) was the right process — but the skill's own example (literal-model `ollamaText('llama3.3')`) uses a different typing branch than yt-kb's dynamic-model call sites, so it undersold what the fix actually required. The skill was necessary reading, not sufficient. |

## Task 10 live-verification results

Verified against a real running stack (Strapi :1340, client :3005, Ollama with `gemma4-kb:latest` / `nomic-embed-text:latest` / `all-minilm:latest`), plus a throwaway logging proxy in front of Ollama for one check. Full detail in `.superpowers/sdd/2026-08-22-modernize-from-music-kb/task-10-report.md`; headline results:

- **Temperature reaching Ollama — proven on the wire.** The proxy captured the literal outgoing JSON body. `/api/ask` (`modelOptions: { model: CHAT_MODEL, options: { temperature: 0.4 } }`): `{"model":"gemma4-kb:latest","options":{"temperature":0.4},...}`. `/api/notes/compose` (`temperature: 0.3`): `{"model":"gemma4-kb:latest","options":{"temperature":0.3},...}`. This closes the one gap every static reviewer flagged as unverifiable by typechecking alone.
- **`TOOL_CALL_END` fires once, not twice** — see risk #4 above.
- **Structured output: pass.** Live regenerate cycled `summaryStatus` pending → generated, wrote real (non-cached) `valueScore` (70 → 82, proving a genuine model call), unchanged `signalScore` (deterministic), recomputed `finalScore`, and produced non-zero BM25-grounded `timeSec` values for every section.
- **Semantic search / embeddings: pass.** Live cosine scan over 148 videos (768-dim `nomic-embed-text` vectors) returned sensibly ranked, non-empty results for a topical query.
- **Plain chat: pass.** 395 well-formed `TEXT_MESSAGE_CONTENT` frames, `RUN_STARTED`→`RUN_FINISHED` bracketed correctly.

### Two genuine defects found and fixed — both pre-existing, not regressions from this upgrade

1. **Tool call results were always dropped.** 0.47's split of `TOOL_CALL_END` (input only) from `TOOL_CALL_RESULT` (result only) meant `chat-stream.ts`'s parser — written for a single combined event — read `event.result` off `TOOL_CALL_END`, got `undefined`, and the real `TOOL_CALL_RESULT` event fell into `default: return null`. Every tool call's result silently rendered as empty in the UI's "Result" accordion, even though the tool genuinely ran and returned real data.
2. **`RUN_ERROR` was completely unhandled.** No case existed for it in `chat-stream.ts`; it fell into `default: return null`. Killing Ollama mid-stream produced **zero** user-visible feedback — not even a raw stack fragment — because `friendlyOllamaError` was never reached.

**Correction to the plan/spec text:** both the plan and spec asserted "a test already depends on [`RUN_ERROR` firing under its old name]." This was checked and found **false** — `git grep -c RUN_ERROR 6c2b3d6 -- client/src` (the branch's merge-base) returns zero, as does `TOOL_CALL_RESULT`. Neither event name was ever handled at any point in this branch's history before Task 10. **Both defects predate this branch and are not TanStack AI 0.47 regressions** — they are pre-existing gaps that this verification pass was simply the first to notice, because it was the first to drive real tool-calling and error-path traffic through the parser closely enough to see it. The fix, and its extension to the two hand-rolled SSE readers that don't go through `chat-stream.ts` (`useLibraryChat.ts` for `/api/ask`, `NoteComposer.tsx` for `/api/notes/compose`), is recorded in commits `a688612`, `21c00de`, `9f09195`, `38cc563`.

Net effect on the suite: 170 → 181 tests (11 new: tool-result merge/dedup/interleave cases, `RUN_ERROR` handling in all four streaming surfaces, two new `ollama-errors.ts` host-unreachable patterns for `ECONNRESET` / `socket hang up`).

## Files touched across the whole upgrade

- `client/package.json`, `client/yarn.lock` — version bumps.
- `client/src/lib/services/{reader,learning,digest,notes,chat-stream,ollama-errors}.ts`
- `client/src/routes/{api.ask.tsx,api.notes.compose.tsx,api.chat.tsx}`
- `client/src/lib/hooks/useLibraryChat.ts`, `client/src/components/NoteComposer.tsx`
- Corresponding `*.test.ts` files for the above.

No `server/` files, no `routeTree.gen.ts`, in scope for any part of this migration.
