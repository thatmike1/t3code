// @effect-diagnostics nodeBuiltinImport:off - disposable HTTP fixtures exercise the browser fetch boundary.
import * as NodeHttp from "node:http";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { fetchBeadBoardIds } from "./beadBoardIds";
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
    "disables short links when a board fails or returns malformed data (%s)",
    async (status) => {
      const general = await board("ccChat-general", { ids: ["ccChat-general-abc"] });
      const nexi = await board("nexiflow", { ids: [42] }, status);
      expect(await fetchBeadBoardIds([general, nexi])).toEqual(new Set());
    },
  );
  it("does not mistake another repository's board for an empty board", async () => {
    const wrong = await board("nexiflow", { ids: ["ccChat-general-abc"] });
    expect(await fetchBeadBoardIds([wrong])).toEqual(new Set());
  });
  it("does not choose between conflicting origins for a prefix", () => {
    expect(
      beadBoardHref("nexiflow-abc", [
        { prefix: "nexiflow", origin: "http://localhost:1" },
        { prefix: "nexiflow", origin: "http://localhost:2" },
      ]),
    ).toBeNull();
  });
});
