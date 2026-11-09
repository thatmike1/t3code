// @effect-diagnostics nodeBuiltinImport:off - disposable HTTP fixtures exercise the browser fetch boundary.
import * as NodeHttp from "node:http";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createBeadBoardIdsStore, fetchBeadBoardIds } from "./beadBoardIds";
import { beadBoardHref, shortBeadIdCandidate } from "../markdown-bead-links";

const servers: NodeHttp.Server[] = [];
async function board(prefix: string, body: unknown, status = 200) {
  const server = NodeHttp.createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test address");
  return { prefix, origin: `http://127.0.0.1:${address.port}` };
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("configured bead boards", () => {
  it("routes full and confirmed short IDs to their own board and rejects collisions", async () => {
    const general = await board("ccChat-general", {
      ids: ["ccChat-general-zl51", "ccChat-general-abc"],
    });
    const nexi = await board("nexiflow", {
      ids: ["nexiflow-1234", "nexiflow-abc", "nexiflow-1234.2"],
    });
    const boards = [general, nexi];
    const ids = await fetchBeadBoardIds(boards);
    expect(shortBeadIdCandidate("1234", ids)).toBe("nexiflow-1234");
    expect(shortBeadIdCandidate("1234.2", ids)).toBe("nexiflow-1234.2");
    expect(shortBeadIdCandidate("abc", ids)).toBeNull();
    expect(beadBoardHref("nexiflow-1234", boards)).toBe(`${nexi.origin}/#nexiflow-1234`);
    expect(beadBoardHref("ccChat-general-zl51", boards)).toBe(
      `${general.origin}/#ccChat-general-zl51`,
    );
    expect(beadBoardHref("unknown-123", boards)).toBeNull();
  });
  it.each([503, 200])(
    "keeps the boards that answered when another fails or returns malformed data (%s)",
    async (status) => {
      const general = await board("ccChat-general", { ids: ["ccChat-general-abc"] });
      const nexi = await board("nexiflow", { ids: [42] }, status);
      const ids = await fetchBeadBoardIds([general, nexi]);
      expect(ids).toEqual(new Set(["ccChat-general-abc"]));
      expect(shortBeadIdCandidate("abc", ids)).toBe("ccChat-general-abc");
    },
  );
  it("does not mistake another repository's board for an empty board", async () => {
    const general = await board("ccChat-general", { ids: ["ccChat-general-zl51"] });
    const wrong = await board("nexiflow", { ids: ["ccChat-general-abc"] });
    expect(await fetchBeadBoardIds([general, wrong])).toEqual(new Set(["ccChat-general-zl51"]));
  });
  it("does not choose between conflicting origins for a prefix", () => {
    expect(
      beadBoardHref("nexiflow-abc", [
        { prefix: "nexiflow", origin: "http://localhost:1" },
        { prefix: "nexiflow", origin: "http://localhost:2" },
      ]),
    ).toBeNull();
  });
  it("keeps the same Set while a refresh returns the same ids", async () => {
    const boards = [{ prefix: "ccChat-general", origin: "http://127.0.0.1:1" }];
    const responses = [["ccChat-general-abc"], ["ccChat-general-abc"], ["ccChat-general-xyz"]];
    const store = createBeadBoardIdsStore(boards, async () => new Set(responses.shift()));
    using now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    await store.refresh();
    const first = store.getSnapshot();
    expect(first).toEqual(new Set(["ccChat-general-abc"]));
    now.mockReturnValue(2_000_000);
    await store.refresh();
    expect(store.getSnapshot()).toBe(first);
    now.mockReturnValue(3_000_000);
    await store.refresh();
    expect(store.getSnapshot()).toEqual(new Set(["ccChat-general-xyz"]));
  });
});
