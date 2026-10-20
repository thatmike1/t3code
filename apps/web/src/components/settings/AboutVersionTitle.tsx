import { msg, T, useGT } from "gt-react";

import { APP_VERSION } from "../../branding";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { InlineButton } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveAboutVersion } from "./SettingsPanels.logic";

export function AboutVersionTitle() {
  const gt = useGT();
  // fork: the desktop build's own version (0.1.7-fork.<date>.<n>), not the web bundle's
  const version = resolveAboutVersion(APP_VERSION, useDesktopUpdateState()?.currentVersion);
  const { copyToClipboard } = useCopyToClipboard<void>({
    target: {
      target: "version",
      unavailableMessage: msg("Clipboard API is unavailable while copying version."),
      failureMessage: msg("Failed to copy version to the clipboard."),
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy version"),
          description: error.message,
        }),
      );
    },
  });

  return (
    <span className="inline-flex items-baseline gap-2">
      <span>
        <T>Version</T>
      </span>
      <code className="text-2xs font-medium">
        <Tooltip>
          <TooltipTrigger
            render={
              <InlineButton
                tone="muted"
                aria-label={gt("Copy version {version}", { version })}
                onClick={() => copyToClipboard(version, undefined)}
              >
                {version}
              </InlineButton>
            }
          />
          <TooltipPopup>
            <T>Copy version</T>
          </TooltipPopup>
        </Tooltip>
      </code>
    </span>
  );
}
