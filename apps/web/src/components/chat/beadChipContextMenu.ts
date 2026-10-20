import type { ContextMenuItem } from "@t3tools/contracts";

export type BeadChipContextMenuAction = "copy-id" | "copy-link" | "open-in-preview";

/** Copy the id first: it is what goes into a prompt or a `bd` command. */
const BEAD_CHIP_COPY_ITEMS = [
  { id: "copy-id", label: "Copy bead ID", icon: "copy" },
  { id: "copy-link", label: "Copy link" },
] as const satisfies readonly ContextMenuItem<BeadChipContextMenuAction>[];

const BEAD_CHIP_OPEN_IN_PREVIEW_ITEM = {
  id: "open-in-preview",
  label: "Open in T3 browser",
} as const satisfies ContextMenuItem<BeadChipContextMenuAction>;

/**
 * The right-click on a bead chip. The chip is a link to the board, so without this the
 * platform's menu only offers Copy Link, which puts the whole local board URL on the clipboard
 * when the reader wanted the id. Left-click still opens the board.
 *
 * "Open in T3 browser" is offered only where the chip has a thread beside it whose browser panel
 * can take the board, which `openInPreview` being present stands for.
 *
 * A menu that could not be shown resolves quietly; a failed copy rejects so the caller can say so.
 * The open reports its own failures.
 */
export async function showBeadChipContextMenu(options: {
  readonly id: string;
  readonly href: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly showContextMenu: (
    items: readonly ContextMenuItem<BeadChipContextMenuAction>[],
    position: { readonly x: number; readonly y: number },
  ) => Promise<BeadChipContextMenuAction | null>;
  readonly copyText: (text: string, target: string) => Promise<unknown>;
  readonly openInPreview?: ((href: string) => Promise<void>) | undefined;
}): Promise<void> {
  const items = options.openInPreview
    ? [...BEAD_CHIP_COPY_ITEMS, BEAD_CHIP_OPEN_IN_PREVIEW_ITEM]
    : BEAD_CHIP_COPY_ITEMS;
  let action: BeadChipContextMenuAction | null;
  try {
    action = await options.showContextMenu(items, options.position);
  } catch {
    return;
  }
  if (action === "copy-id") await options.copyText(options.id, "bead ID");
  else if (action === "copy-link") await options.copyText(options.href, "link");
  else if (action === "open-in-preview") await options.openInPreview?.(options.href);
}
