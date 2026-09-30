// fork builds are versioned `<upstream version>-fork.<yyyymmdd>.<hhmm>` so the
// fork's own release feed can order them. the upstream version is the exact
// release the fork is based on, a nightly included
// (`0.0.46-nightly.20261012.3010-fork.20261012.1530`). anything that names an
// upstream release asset (the ssh remote's cli archive) needs the upstream part
// only, because the fork publishes nothing but the desktop app.
const FORK_VERSION_SUFFIX = /-fork\.\d{8}\.\d+$/;

/**
 * the upstream release a fork build was cut from: `0.0.42-fork.20260930.1412`
 * gives `0.0.42`, `0.0.46-nightly.20261012.3010-fork.20261012.1530` gives
 * `0.0.46-nightly.20261012.3010`. any other version comes back unchanged.
 */
export function upstreamBaseVersion(version: string): string {
  return version.replace(FORK_VERSION_SUFFIX, "");
}
