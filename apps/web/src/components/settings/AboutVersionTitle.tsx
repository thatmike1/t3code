import { useRef } from "react";

import { APP_VERSION } from "../../branding";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { showAnchoredCopySuccessToast } from "../ui/anchoredCopyToast";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveAboutVersion } from "./SettingsPanels.logic";

export function AboutVersionTitle() {
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  // fork: the desktop build's own version (0.1.7-fork.<date>.<n>), not the web bundle's
  const version = resolveAboutVersion(APP_VERSION, useDesktopUpdateState()?.currentVersion);
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: "version",
    onCopy: () => showAnchoredCopySuccessToast(copyButtonRef),
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not copy version",
          description: error.message,
        }),
      );
    },
  });

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>Version</span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                ref={copyButtonRef}
                tone="muted"
                aria-label={`Copy version ${version}`}
                onClick={() => copyToClipboard(version, undefined)}
              >
                {version}
              </InlineButton>
            }
          />
          <TooltipPopup>Copy version</TooltipPopup>
        </Tooltip>
      </code>
    </span>
  );
}
