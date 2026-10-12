import type { ContextMenuItem } from "@t3tools/contracts";

export type BeadChipContextMenuAction = "copy-id" | "copy-link";

/** Copy the id first: it is what goes into a prompt or a `bd` command. */
const BEAD_CHIP_CONTEXT_MENU_ITEMS = [
  { id: "copy-id", label: "Copy bead ID", icon: "copy" },
  { id: "copy-link", label: "Copy link" },
] as const satisfies readonly ContextMenuItem<BeadChipContextMenuAction>[];

/**
 * The right-click on a bead chip. The chip is a link to the board, so without this the
 * platform's menu only offers Copy Link, which puts the whole local board URL on the clipboard
 * when the reader wanted the id. Left-click still opens the board.
 *
 * A menu that could not be shown resolves quietly; a failed copy rejects so the caller can say so.
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
}): Promise<void> {
  let action: BeadChipContextMenuAction | null;
  try {
    action = await options.showContextMenu(BEAD_CHIP_CONTEXT_MENU_ITEMS, options.position);
  } catch {
    return;
  }
  if (action === "copy-id") await options.copyText(options.id, "bead ID");
  else if (action === "copy-link") await options.copyText(options.href, "link");
}
