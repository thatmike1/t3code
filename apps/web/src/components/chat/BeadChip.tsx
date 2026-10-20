import { CircleDotIcon } from "lucide-react";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";
import { ContextChip, ContextChipLabel } from "../ContextChip";
import { toastManager } from "../ui/toast";
import { showBeadChipContextMenu } from "./beadChipContextMenu";

/**
 * A beads issue id, linking into the local beadside. The board is a plain web
 * app, so the chip is an ordinary anchor and the runtime decides where it
 * opens. Right-click offers the bare id to copy, and the board in T3's own
 * browser when `openInPreview` is given.
 */
export function BeadChip(props: {
  id: string;
  href: string;
  copyText: string;
  /** Text as written, when it is shorter than the id (`qju` for `ccChat-general-qju`). */
  label?: string;
  /** Opens the board in the thread's browser panel; absent where there is none. */
  openInPreview?: ((href: string) => Promise<void>) | undefined;
}) {
  return (
    // the element kind carries the amber hue the bead chip has always had
    <ContextChip
      kind="element"
      render={<a href={props.href} target="_blank" rel="noopener noreferrer" />}
      data-markdown-copy={props.copyText}
      className="font-mono no-underline"
      onContextMenu={(event) => {
        const api = readLocalApi();
        if (!api) return;
        event.preventDefault();
        event.stopPropagation();
        void showBeadChipContextMenu({
          id: props.id,
          href: props.href,
          position: { x: event.clientX, y: event.clientY },
          showContextMenu: (items, position) => api.contextMenu.show(items, position),
          copyText: writeTextToClipboard,
          openInPreview: props.openInPreview,
        }).catch(() => {
          toastManager.add({ type: "error", title: "Could not copy" });
        });
      }}
    >
      <CircleDotIcon aria-hidden="true" className="opacity-85" />
      <ContextChipLabel>{props.label ?? props.id}</ContextChipLabel>
    </ContextChip>
  );
}
