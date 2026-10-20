import { describe, expect, it, vi } from "vite-plus/test";

import { showBeadChipContextMenu } from "./beadChipContextMenu";

const BEAD = {
  id: "ccChat-general-qju",
  href: "http://localhost:4173/?issue=ccChat-general-qju",
  position: { x: 12, y: 24 },
};

function createHarness(selection: "copy-id" | "copy-link" | "open-in-preview" | null) {
  return {
    showContextMenu: vi.fn().mockResolvedValue(selection),
    copyText: vi.fn().mockResolvedValue(undefined),
  };
}

describe("bead chip context menu", () => {
  it("offers the bare id ahead of the link", async () => {
    const harness = createHarness(null);

    await showBeadChipContextMenu({ ...BEAD, ...harness });

    expect(harness.showContextMenu).toHaveBeenCalledWith(
      [
        { id: "copy-id", label: "Copy bead ID", icon: "copy" },
        { id: "copy-link", label: "Copy link" },
      ],
      BEAD.position,
    );
    expect(harness.copyText).not.toHaveBeenCalled();
  });

  it("copies the full id alone, even when the chip shows a short label", async () => {
    const harness = createHarness("copy-id");

    await showBeadChipContextMenu({ ...BEAD, ...harness });

    expect(harness.copyText).toHaveBeenCalledWith("ccChat-general-qju", "bead ID");
  });

  it("copies the board link when asked for it", async () => {
    const harness = createHarness("copy-link");

    await showBeadChipContextMenu({ ...BEAD, ...harness });

    expect(harness.copyText).toHaveBeenCalledWith(BEAD.href, "link");
  });

  it("does nothing when the menu cannot be shown", async () => {
    const harness = createHarness(null);
    harness.showContextMenu.mockRejectedValue(new Error("menu unavailable"));

    await expect(showBeadChipContextMenu({ ...BEAD, ...harness })).resolves.toBeUndefined();
    expect(harness.copyText).not.toHaveBeenCalled();
  });

  it("offers the T3 browser after the copies when the chip can open there", async () => {
    const harness = createHarness(null);
    const openInPreview = vi.fn().mockResolvedValue(undefined);

    await showBeadChipContextMenu({ ...BEAD, ...harness, openInPreview });

    expect(harness.showContextMenu).toHaveBeenCalledWith(
      [
        { id: "copy-id", label: "Copy bead ID", icon: "copy" },
        { id: "copy-link", label: "Copy link" },
        { id: "open-in-preview", label: "Open in T3 browser" },
      ],
      BEAD.position,
    );
    expect(openInPreview).not.toHaveBeenCalled();
  });

  it("opens the board link in the T3 browser when asked", async () => {
    const harness = createHarness("open-in-preview");
    const openInPreview = vi.fn().mockResolvedValue(undefined);

    await showBeadChipContextMenu({ ...BEAD, ...harness, openInPreview });

    expect(openInPreview).toHaveBeenCalledWith(BEAD.href);
    expect(harness.copyText).not.toHaveBeenCalled();
  });

  it("rejects when the copy fails", async () => {
    const harness = createHarness("copy-id");
    const cause = new Error("clipboard denied");
    harness.copyText.mockRejectedValue(cause);

    await expect(showBeadChipContextMenu({ ...BEAD, ...harness })).rejects.toBe(cause);
  });
});
