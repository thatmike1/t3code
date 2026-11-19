import { DEFAULT_THREAD_WORKSPACES } from "@t3tools/shared/threadWorkspaces";
import { describe, expect, it } from "vite-plus/test";

import { askJev, buildJevRequestBody, JEV_API_URL, parseJevAnswer } from "./jev.ts";

const workspaces = DEFAULT_THREAD_WORKSPACES;

function response(choice: unknown, confidence: unknown) {
  return { answers: { workspace: { type: "choice", choice, confidence } } };
}

describe("buildJevRequestBody", () => {
  it("asks one choice question whose choices are the workspace names", () => {
    const body = buildJevRequestBody(workspaces, {
      projectName: "ccChat-general",
      title: "Firefox tabs",
      messages: ["clean up my tabs", "and the bookmarks"],
    }) as {
      state: Record<string, unknown>;
      questions: { workspace: { type: string; criteria: Record<string, string> } };
    };
    expect(body.state).toEqual({
      project: "ccChat-general",
      thread_title: "Firefox tabs",
      first_message: "clean up my tabs",
      later_messages: ["and the bookmarks"],
    });
    expect(body.questions.workspace.type).toBe("choice");
    expect(Object.keys(body.questions.workspace.criteria)).toEqual(["Work", "Life"]);
  });
});

describe("parseJevAnswer", () => {
  it("maps a confident choice back to its workspace id", () => {
    expect(parseJevAnswer(response("Life", 0.8), workspaces)).toEqual({
      _tag: "tagged",
      workspaceId: "life",
      confidence: 0.8,
    });
  });

  it("leaves the thread untagged below the confidence floor", () => {
    expect(parseJevAnswer(response("Work", 0.4), workspaces)._tag).toBe("unsure");
  });

  it("treats an unknown choice or a malformed body as unsure", () => {
    expect(parseJevAnswer(response("Hobby", 0.9), workspaces)._tag).toBe("unsure");
    expect(parseJevAnswer({ error: "nope" }, workspaces)._tag).toBe("unsure");
    expect(parseJevAnswer(response("Work", "high"), workspaces)._tag).toBe("unsure");
  });
});

describe("askJev", () => {
  it("posts the body with the key as a bearer token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const answer = await askJev("k", { a: 1 }, async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response("Work", 0.9)), { status: 200 });
    });
    expect(answer).toEqual(response("Work", 0.9));
    expect(calls[0]?.url).toBe(JEV_API_URL);
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer k");
  });

  it("throws on an error status", async () => {
    await expect(
      askJev("k", {}, async () => new Response("denied", { status: 401 })),
    ).rejects.toThrow("401");
  });
});
