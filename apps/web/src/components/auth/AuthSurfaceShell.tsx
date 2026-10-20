import type { ReactNode } from "react";

import { useClientSettings, useClientSettingsHydrated } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { isForkArtworkDirection } from "../forkArtwork";
import { APP_DISPLAY_NAME, APP_STAGE_LABEL } from "../../branding";
import { resolveSidebarStageBackdropVariant, StageBackdropArt } from "../SidebarStageBackdrop";
import { StandalonePage } from "../ui/standalone-page";

export function AuthSurfaceShell({ children }: { readonly children: ReactNode }) {
  const forkArtwork = useClientSettings((settings) => settings.forkArtwork);
  const hydrated = useClientSettingsHydrated();
  const stageVariant =
    hydrated && forkArtwork !== "off"
      ? forkArtwork
      : resolveSidebarStageBackdropVariant(APP_STAGE_LABEL);
  const forkArt = isForkArtworkDirection(stageVariant) || stageVariant === "scribble";

  return (
    <StandalonePage
      tone="brand"
      masthead={
        <header
          className={cn(
            "relative h-24 overflow-hidden",
            forkArt
              ? "bg-sidebar text-foreground"
              : "bg-[linear-gradient(135deg,#1e61de,#17348e)] text-white",
          )}
        >
          {stageVariant ? (
            <div className="absolute inset-0" aria-hidden>
              <StageBackdropArt variant={stageVariant} />
            </div>
          ) : (
            <div
              aria-hidden
              className="absolute inset-0 bg-[radial-gradient(circle_at_75%_25%,rgba(136,204,255,0.5),transparent_38%),linear-gradient(135deg,#2468df,#172f82)]"
            />
          )}
          {!forkArt ? (
            <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_20%,rgba(7,18,55,0.46)_100%)]" />
          ) : null}
          <div className="relative h-full p-5 sm:p-6">
            <p
              className={cn(
                "text-3xs font-semibold tracking-widest uppercase",
                forkArt ? "text-foreground/80" : "text-white/80",
              )}
            >
              {APP_DISPLAY_NAME}
            </p>
          </div>
        </header>
      }
    >
      {children}
    </StandalonePage>
  );
}
