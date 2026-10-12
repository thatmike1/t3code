import { describe, expect, it } from "@effect/vitest";

import { decodeLz4Block, decodeMozLz4, MozLz4Error } from "./mozLz4.ts";

/**
 * A small synthetic session store, compressed by the reference encoder
 * (python-lz4's `lz4.block.compress(..., store_size=False)`) behind the
 * mozlz4 header. Generated for this test; it is not anyone's real session.
 */
const SESSION_FIXTURE_BASE64 =
  "bW96THo0MAAUBgAA8yV7InZlcnNpb24iOiBbInNlc3Npb25yZXN0b3JlIiwgMV0sICJ3aW5kb3dzIjogW3sidGFiCgBjZW50cmllDQD/IHVybCI6ICJodHRwOi8vMTI3LjAuMC4xOjEzNDQvIiwgInRpdGxlIjogInQifSwgMQAMfHByb3RvL2E4API/XSwgImluZGV4IjogMiwgImV4dERhdGEiOiB7ImV4dGVuc2lvbjp7M2MwNzgxNTYtOTc5Yy00OThiLTg5OTAtODVmNzk4N2RkOTI5fTpkOgDxBiJ7XCJpZFwiOiAxLCBcInBhbmVsSRAAUlwicFwiFABCcmVudBUAES0mAFFmb2xkZSUA8RNmYWxzZSwgXCJjdXN0b21Db2xvclwiOiBcInJlZFwifSJ97gAPLAEB8QhmaWxlOi8vL2hvbWUvbWlrZS9zaXRlL+EAXy5odG1s/wAJHzH/AD4SMusAD/8ANV9ncmVlbgEBC/0EaHR0cHM6Ly9leGFtcGxlLmNvbSsCCPMBD/QAPx8z9AAmD9kBCUZtb3otjwLxBS8vYWJjL3NpZGViZXJ5L2dyb3Vw3wEvI0fhAVsfNO0AFw3NAkJibHVlzQERXdACDwYEEu9sb2NhbGhvc3Q6NTE3M9sBXB81lQMCU3B1cnBsygAPmAMFv2Fib3V0OmJsYW5roQEK/wB9XX1dLCAiX2Nsb3NlZFclBSgiOS9EAA9vAAoP8QM4Dd8B4HBpbmtcIn0ifX1dfV19";

const fixtureBytes = () => new Uint8Array(Buffer.from(SESSION_FIXTURE_BASE64, "base64"));
const ascii = (text: string) => new TextEncoder().encode(text);

describe("decodeMozLz4", () => {
  it("decodes a reference-encoded session file to its JSON", () => {
    const text = new TextDecoder().decode(decodeMozLz4(fixtureBytes()));
    expect(text).toHaveLength(1556);
    const session = JSON.parse(text);
    expect(session.windows).toHaveLength(2);
    expect(session.windows[0].tabs[0].entries[1].url).toBe("http://127.0.0.1:1344/proto/a");
  });

  it("rejects a file without the mozlz4 magic", () => {
    expect(() => decodeMozLz4(ascii('{"windows":[]}'))).toThrow(MozLz4Error);
  });

  it("rejects a truncated file instead of reading past its end", () => {
    const bytes = fixtureBytes();
    expect(() => decodeMozLz4(bytes.subarray(0, bytes.length - 40))).toThrow(MozLz4Error);
  });
});

describe("decodeLz4Block", () => {
  it("copies an overlapping match byte by byte", () => {
    // token 0x15: one literal "a", then a match of 5 + 4 = 9 bytes at offset 1.
    const block = new Uint8Array([0x15, 0x61, 0x01, 0x00]);
    expect(new TextDecoder().decode(decodeLz4Block(block, 10))).toBe("aaaaaaaaaa");
  });

  it("reads long literal runs through their 255-continuation bytes", () => {
    const literals = ascii("x".repeat(300));
    // 15 + 255 + 30 = 300
    const block = new Uint8Array([0xf0, 255, 30, ...literals]);
    expect(decodeLz4Block(block, 300)).toEqual(literals);
  });

  it("rejects a match that points before the start of the output", () => {
    const block = new Uint8Array([0x10, 0x61, 0x05, 0x00]);
    expect(() => decodeLz4Block(block, 5)).toThrow(MozLz4Error);
  });

  it("rejects output longer than the header promised", () => {
    expect(() => decodeLz4Block(new Uint8Array([0x30, 0x61, 0x62, 0x63]), 2)).toThrow(MozLz4Error);
  });
});
