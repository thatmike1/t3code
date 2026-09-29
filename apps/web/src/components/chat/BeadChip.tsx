import { CircleDotIcon } from "lucide-react";
import { ContextChip, ContextChipLabel } from "../ContextChip";

/**
 * A beads issue id, linking into the local beadside. The board is a plain web
 * app, so the chip is an ordinary anchor and the runtime decides where it
 * opens.
 */
export function BeadChip(props: {
  id: string;
  href: string;
  copyText: string;
  /** Text as written, when it is shorter than the id (`qju` for `ccChat-general-qju`). */
  label?: string;
}) {
  return (
    // the element kind carries the amber hue the bead chip has always had
    <ContextChip
      kind="element"
      render={<a href={props.href} target="_blank" rel="noopener noreferrer" />}
      data-markdown-copy={props.copyText}
      className="font-mono no-underline"
    >
      <CircleDotIcon aria-hidden="true" className="opacity-85" />
      <ContextChipLabel>{props.label ?? props.id}</ContextChipLabel>
    </ContextChip>
  );
}
