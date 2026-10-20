import { useId } from "react";
import type { ForkArtwork } from "@t3tools/contracts/settings";

import { useTheme } from "../hooks/useTheme";

export type ForkArtworkDirection = Exclude<ForkArtwork, "off">;

export function isForkArtworkDirection(value: string | null): value is ForkArtworkDirection {
  return value === "paint" || value === "bonsai";
}

export function resolveForkArtworkAssets(direction: ForkArtworkDirection, theme: "dark" | "light") {
  const base = `/fork-artwork/${direction}-${theme}`;
  return {
    strip: `${base}-strip.webp`,
    circle: `${base}-circle.webp`,
    arrow: `${base}-arrow.png`,
  };
}

export function ForkArtworkImage({
  direction,
  slot,
}: {
  direction: ForkArtworkDirection;
  slot: "strip" | "circle" | "arrow";
}) {
  const patternId = useId();
  const { resolvedTheme } = useTheme();
  const assets = resolveForkArtworkAssets(direction, resolvedTheme);
  if (slot === "strip") {
    return (
      <>
        <svg
          data-fork-artwork={`${direction}-${resolvedTheme}`}
          className="h-full w-full"
          preserveAspectRatio="xMinYMin slice"
          viewBox="0 0 8192 160"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id={patternId} width="1024" height="160" patternUnits="userSpaceOnUse">
              <image href={assets.strip} width="1024" height="160" />
            </pattern>
          </defs>
          <rect width="100%" height="160" fill={`url(#${patternId})`} />
        </svg>
        <div className="absolute inset-y-0 left-0 w-48 bg-linear-to-r from-sidebar/85 via-sidebar/40 to-transparent" />
      </>
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      draggable={false}
      src={assets[slot]}
      className={slot === "circle" ? "h-full w-full" : "pointer-events-none size-5"}
    />
  );
}
