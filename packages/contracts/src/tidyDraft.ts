import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

/**
 * the composer's Tidy button: the thread's agent rewrites a dictated draft in the user's voice and
 * marks which asks of its last reply the draft answers. it asks a side question using the session's prompt
 * cache, with a normal warm-up turn first if Claude's cache is cold.
 */
export const TIDY_DRAFT_MAX_LENGTH = 50_000;

export const TidyDraftInput = Schema.Struct({
  threadId: ThreadId,
  draft: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(TIDY_DRAFT_MAX_LENGTH)),
});
export type TidyDraftInput = typeof TidyDraftInput.Type;

export const TidyDraftAsk = Schema.Struct({
  /** a short line naming what the agent's last reply asked the user for. */
  ask: Schema.String,
  answered: Schema.Boolean,
});
export type TidyDraftAsk = typeof TidyDraftAsk.Type;

export const TidyDraftResult = Schema.Struct({
  draft: Schema.String,
  asks: Schema.Array(TidyDraftAsk),
  /**
   * "live" asked the running session; "fork" asked a short-lived copy of it;
   * "warmed" sent a warm-up turn before asking the running session.
   */
  source: Schema.Literals(["live", "fork", "warmed"]),
});
export type TidyDraftResult = typeof TidyDraftResult.Type;

export class TidyDraftError extends Schema.TaggedError<TidyDraftError>()("TidyDraftError", {
  threadId: ThreadId,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
