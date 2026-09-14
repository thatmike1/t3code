import { CircleDotIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";

/**
 * A beads issue id, linking into the local bd-board. The board is a plain web
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
    <a
      href={props.href}
      target="_blank"
      rel="noopener noreferrer"
      data-markdown-copy={props.copyText}
      className={cn(
        CHAT_INLINE_CHIP_CLASS_NAME,
        "border-amber-500/25 bg-amber-500/12 font-mono text-amber-700 no-underline hover:bg-amber-500/20 dark:text-amber-300",
      )}
    >
      <CircleDotIcon
        aria-hidden="true"
        className="block size-[1.17em] shrink-0 self-center opacity-85"
      />
      <span className={CHAT_INLINE_CHIP_LABEL_CLASS_NAME}>{props.label ?? props.id}</span>
    </a>
  );
}
