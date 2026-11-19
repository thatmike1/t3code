/**
 * fork: the Jev decision model (TypeSafe's choice-with-confidence API), asked
 * which workspace a thread belongs to. One question, the workspace names as
 * its choices; a low-confidence answer leaves the thread untagged.
 *
 * @module jev
 */
import type { ThreadWorkspace } from "@t3tools/contracts";

export const JEV_API_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-1.13.0";
/** below this the classifier's pick is not trusted and the thread stays untagged */
export const JEV_MIN_CONFIDENCE = 0.6;
const MAX_MESSAGE_CHARS = 3000;
const QUESTION_KEY = "workspace";

export interface JevThreadContext {
  readonly projectName: string | null;
  readonly title: string;
  /** the thread's first user messages, oldest first */
  readonly messages: ReadonlyArray<string>;
}

export function buildJevRequestBody(
  workspaces: ReadonlyArray<ThreadWorkspace>,
  context: JevThreadContext,
): Record<string, unknown> {
  const criteria: Record<string, string> = {};
  for (const workspace of workspaces) {
    criteria[workspace.name] = workspace.hint.length > 0 ? workspace.hint : workspace.name;
  }
  const [first, ...later] = context.messages.map((text) => text.slice(0, MAX_MESSAGE_CHARS));
  return {
    model: JEV_MODEL,
    state: {
      project: context.projectName ?? "",
      thread_title: context.title,
      first_message: first ?? "",
      ...(later.length > 0 ? { later_messages: later } : {}),
    },
    questions: {
      [QUESTION_KEY]: {
        type: "choice",
        instructions:
          "This is a chat thread between a user and a coding agent. Which area of the user's life does the thread belong to? Judge by what the first message asks for; the project is only where the chat was started.",
        criteria,
      },
    },
  };
}

export type JevAnswer =
  | { readonly _tag: "tagged"; readonly workspaceId: string; readonly confidence: number }
  | { readonly _tag: "unsure"; readonly choice: string | null; readonly confidence: number | null };

/** maps the answer's choice back to a workspace id, or unsure when it should not be applied. */
export function parseJevAnswer(
  response: unknown,
  workspaces: ReadonlyArray<ThreadWorkspace>,
  minConfidence = JEV_MIN_CONFIDENCE,
): JevAnswer {
  const answer = readAnswer(response);
  if (answer === null) return { _tag: "unsure", choice: null, confidence: null };
  const workspace = workspaces.find((candidate) => candidate.name === answer.choice);
  if (workspace === undefined || answer.confidence < minConfidence) {
    return { _tag: "unsure", choice: answer.choice, confidence: answer.confidence };
  }
  return { _tag: "tagged", workspaceId: workspace.id, confidence: answer.confidence };
}

function readAnswer(response: unknown): { choice: string; confidence: number } | null {
  if (typeof response !== "object" || response === null) return null;
  const answers = (response as { answers?: unknown }).answers;
  if (typeof answers !== "object" || answers === null) return null;
  const answer = (answers as Record<string, unknown>)[QUESTION_KEY];
  if (typeof answer !== "object" || answer === null) return null;
  const { choice, confidence } = answer as { choice?: unknown; confidence?: unknown };
  if (typeof choice !== "string" || typeof confidence !== "number") return null;
  return { choice, confidence };
}

export type JevFetch = (url: string, init: RequestInit) => Promise<Response>;

/** one POST, no retries; throws on a network error, a non-2xx status or a non-JSON body. */
export async function askJev(
  key: string,
  body: Record<string, unknown>,
  fetchImpl: JevFetch = globalThis.fetch,
): Promise<unknown> {
  const response = await fetchImpl(JEV_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`jev answered ${response.status} ${detail}`);
  }
  return response.json();
}
