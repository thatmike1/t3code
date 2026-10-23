import { DEFAULT_CLIENT_SETTINGS, type ForkArtwork } from "@t3tools/contracts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

// Linux ships as an AppImage, so the .desktop entry users end up with is
// created by whatever integration tool they use (AppImageLauncher names it
// appimagekit_<hash>-….desktop) and its filename is not under our control.
// Electron's app.setAsDefaultProtocolClient resolves the desktop id from
// setDesktopName, which cannot match those files — so the browser keeps
// prompting "Choose an application" for every OAuth callback.
const { logInfo, logWarning } = makeComponentLogger("desktop-linux-url-handler");

const THEMED_ICON_SIZES = [16, 22, 24, 32, 48, 64, 128, 256, 512] as const;

export class DesktopLinuxUrlHandlerRegistrationError extends Schema.TaggedError<DesktopLinuxUrlHandlerRegistrationError>()(
  "DesktopLinuxUrlHandlerRegistrationError",
  {
    step: Schema.Literals(["write-desktop-entry", "set-default-handler"]),
    scheme: Schema.String,
    desktopEntryPath: Schema.optionalKey(Schema.String),
    exitCode: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    const exitCode = this.exitCode === undefined ? "" : `, xdg-mime exit code ${this.exitCode}`;
    return `Failed to register the ${this.scheme}:// URL handler (step: ${this.step}${exitCode}).`;
  }
}

const isRegistrationError = Schema.is(DesktopLinuxUrlHandlerRegistrationError);

export class DesktopLinuxUrlHandlerCacheRefreshError extends Schema.TaggedError<DesktopLinuxUrlHandlerCacheRefreshError>()(
  "DesktopLinuxUrlHandlerCacheRefreshError",
  {
    applicationsDir: Schema.String,
    exitCode: Schema.optionalKey(Schema.Number),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    const exitCode =
      this.exitCode === undefined ? "" : `, update-desktop-database exit code ${this.exitCode}`;
    return `Failed to refresh the desktop MIME cache at ${this.applicationsDir}${exitCode}.`;
  }
}

const isCacheRefreshError = Schema.is(DesktopLinuxUrlHandlerCacheRefreshError);

const escapeDesktopEntryString = (value: string): string =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");

// Exec values are unescaped twice by implementations: first the general
// string-value rules, then the Exec quoting rules — so writing composes the
// layers in reverse.
export function escapeDesktopEntryExecArgument(value: string): string {
  const quoted = value
    .replaceAll("\\", () => "\\\\")
    .replaceAll("`", () => "\\`")
    .replaceAll("$", () => "\\$")
    .replaceAll('"', () => '\\"')
    .replaceAll("%", () => "%%");
  return escapeDesktopEntryString(`"${quoted}"`);
}

// Legacy xdg-open looks up the first Exec word without unquoting it.
const escapeUrlHandlerExecTarget = (value: string): string =>
  /[ \t\n"'\\><~|&;$*?#()`]/.test(value)
    ? escapeDesktopEntryExecArgument(value)
    : escapeDesktopEntryString(value.replaceAll("%", "%%"));

// The AppImage integration entry owns the window identity. This
// hidden URL-only entry must not compete with it for StartupWMClass matching.
export function renderUrlHandlerDesktopEntry(input: {
  readonly displayName: string;
  readonly execTarget: string;
  readonly scheme: string;
  readonly iconPath?: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${escapeDesktopEntryString(input.displayName)}`,
    `Exec=${escapeUrlHandlerExecTarget(input.execTarget)} %U`,
    ...(input.iconPath === undefined ? [] : [`Icon=${escapeDesktopEntryString(input.iconPath)}`]),
    "Terminal=false",
    "NoDisplay=true",
    "StartupNotify=false",
    `MimeType=x-scheme-handler/${input.scheme};`,
    "",
  ].join("\n");
}

// Some docks and bars look the Wayland app id up in the icon theme when no
// visible desktop entry matches the window, for example an AppImage run without
// integration. Theme lookups are case-sensitive, so install both spellings.
const LINUX_THEME_ICON_SIZE = "256x256";

function linuxThemeIconNames(desktopEntryName: string): readonly string[] {
  const appId = desktopEntryName.replace(/\.desktop$/u, "");
  return [...new Set([appId.toLowerCase(), appId])];
}

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

export class DesktopLinuxUrlHandler extends Context.Service<
  DesktopLinuxUrlHandler,
  {
    readonly register: Effect.Effect<void>;
    readonly syncIcon: (artwork: ForkArtwork) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopLinuxUrlHandler") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const assets = yield* DesktopAssets.DesktopAssets;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;

  const scheme = ElectronProtocol.getDesktopScheme(environment.isDevelopment);
  const desktopEntryPath = environment.path.join(
    environment.linuxApplicationsDir,
    environment.linuxDesktopEntryName,
  );
  const iconsDir = environment.path.join(environment.linuxApplicationsDir, "..", "icons");
  const hicolorDir = environment.path.join(iconsDir, "hicolor");
  const themeIconDir = environment.path.join(hicolorDir, LINUX_THEME_ICON_SIZE, "apps");

  const writeDesktopEntry = Effect.fn("desktop.linuxUrlHandler.writeDesktopEntry")(
    function* (iconPath: string | undefined) {
      // inside the mounted AppImage, process.execPath points at a transient
      // /tmp/.mount_* path — the handler must launch the AppImage itself.
      const execTarget = Option.getOrElse(environment.appImagePath, () => process.execPath);
      const content = renderUrlHandlerDesktopEntry({
        displayName: environment.displayName,
        execTarget,
        scheme,
        ...(iconPath === undefined ? {} : { iconPath }),
      });
      // pre-ready setup normally wrote this already. Avoid truncating a valid
      // entry while the portal may be reading it during startup.
      const existing = yield* fileSystem
        .readFileString(desktopEntryPath)
        .pipe(Effect.orElseSucceed(() => null));
      if (existing === content) return;
      yield* fileSystem.makeDirectory(environment.linuxApplicationsDir, { recursive: true });
      yield* fileSystem.writeFileString(desktopEntryPath, content);
    },
    Effect.mapError(
      (cause) =>
        new DesktopLinuxUrlHandlerRegistrationError({
          step: "write-desktop-entry",
          scheme,
          desktopEntryPath,
          cause,
        }),
    ),
  );

  const updateDesktopDatabase = Effect.scoped(
    Effect.gen(function* () {
      const command = ChildProcess.make(
        "update-desktop-database",
        [environment.linuxApplicationsDir],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      const handle = yield* spawner.spawn(command);
      const exitCode = yield* handle.exitCode.pipe(Effect.timeout("5 seconds"));
      if (exitCode !== 0) {
        return yield* new DesktopLinuxUrlHandlerCacheRefreshError({
          applicationsDir: environment.linuxApplicationsDir,
          exitCode,
        });
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      isCacheRefreshError(error)
        ? error
        : new DesktopLinuxUrlHandlerCacheRefreshError({
            applicationsDir: environment.linuxApplicationsDir,
            cause: error,
          }),
    ),
  );

  const refreshIconThemeCache = Effect.scoped(
    Effect.gen(function* () {
      const command = ChildProcess.make("gtk-update-icon-cache", ["-f", "-t", hicolorDir], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        // Releasing a timed-out helper otherwise waits on SIGTERM indefinitely.
        forceKillAfter: "1 second",
      });
      const handle = yield* spawner.spawn(command);
      return yield* handle.exitCode.pipe(Effect.timeout("5 seconds"));
    }),
  );

  const modifiedAt = (filePath: string) =>
    fileSystem
      .stat(filePath)
      .pipe(Effect.map((info) => Option.getOrUndefined(info.mtime)?.getTime() ?? 0));

  const installThemeIcons = Effect.gen(function* () {
    const source = yield* assets.resolveResourcePath(`icons/${LINUX_THEME_ICON_SIZE}.png`);
    if (Option.isNone(source)) return;
    const icon = yield* fileSystem.readFile(source.value);
    const targets = linuxThemeIconNames(environment.linuxDesktopEntryName).map((name) =>
      environment.path.join(themeIconDir, `${name}.png`),
    );
    let changed = false;
    for (const target of targets) {
      const current = yield* fileSystem.readFile(target).pipe(Effect.option);
      if (Option.isSome(current) && sameBytes(current.value, icon)) continue;
      yield* fileSystem.makeDirectory(themeIconDir, { recursive: true });
      yield* fileSystem.writeFile(target, icon);
      changed = true;
    }
    // Only keep an existing cache current. Creating one would leave GTK reading
    // a cache that other tools installing user icons do not update. An icon
    // newer than the cache also retries a refresh that failed on an earlier
    // launch.
    const cachePath = environment.path.join(hicolorDir, "icon-theme.cache");
    const cachedAt = yield* modifiedAt(cachePath).pipe(Effect.option);
    if (Option.isNone(cachedAt)) return;
    let stale = changed;
    for (const target of targets) {
      if (stale) break;
      if ((yield* modifiedAt(target)) > cachedAt.value) stale = true;
    }
    if (!stale) return;
    const exitCode = yield* refreshIconThemeCache;
    if (exitCode !== 0) {
      yield* logWarning("icon theme cache refresh failed", { hicolorDir, exitCode });
    }
  }).pipe(
    Effect.catch((error) =>
      logWarning("app id theme icon install failed", { themeIconDir, category: error._tag }),
    ),
  );

  const setDefaultHandler = Effect.scoped(
    Effect.gen(function* () {
      const command = ChildProcess.make(
        "xdg-mime",
        ["default", environment.linuxDesktopEntryName, `x-scheme-handler/${scheme}`],
        {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      const handle = yield* spawner.spawn(command);
      const exitCode = yield* handle.exitCode;
      if ((exitCode as unknown as number) !== 0) {
        return yield* new DesktopLinuxUrlHandlerRegistrationError({
          step: "set-default-handler",
          scheme,
          exitCode: Number(exitCode),
        });
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      isRegistrationError(error)
        ? error
        : new DesktopLinuxUrlHandlerRegistrationError({
            step: "set-default-handler",
            scheme,
            cause: error,
          }),
    ),
  );

  const artworkIconPath = (artwork: ForkArtwork) =>
    environment.path.join(
      iconsDir,
      `${environment.linuxDesktopEntryName}.${artwork === "bonsai" ? "bonsai" : "paint"}.png`,
    );

  // a launcher with a themed Icon= name (often read-only, so the entry above cannot be
  // rewritten) shows whatever hicolor/<size>/apps/<name>.png holds. Replace only icons
  // that are already installed under the names this app answers to.

  const themedIconNames = [
    environment.linuxDesktopEntryName.replace(/\.desktop$/, ""),
    environment.linuxWmClass,
  ];

  const syncThemedIcons = Effect.fn("desktop.linuxUrlHandler.syncThemedIcons")(
    function* (png: string) {
      let replaced = 0;
      for (const size of THEMED_ICON_SIZES) {
        const source = environment.path.join(
          environment.path.dirname(png),
          "sizes",
          environment.path.basename(png).replace(/-1024\.png$/, `-${size}.png`),
        );
        if (!(yield* fileSystem.exists(source))) continue;
        for (const name of themedIconNames) {
          const target = environment.path.join(
            hicolorDir,
            `${size}x${size}`,
            "apps",
            `${name}.png`,
          );
          if (!(yield* fileSystem.exists(target))) continue;
          yield* fileSystem.copyFile(source, target);
          replaced += 1;
        }
      }
      if (replaced === 0) return;
      // the shell reloads the theme when the directory changes; the cache must not go stale.
      // node's utimes takes seconds when given a number.
      const nowSeconds = (yield* Clock.currentTimeMillis) / 1000;
      yield* fileSystem.utimes(hicolorDir, nowSeconds, nowSeconds);
      if (yield* fileSystem.exists(environment.path.join(hicolorDir, "icon-theme.cache"))) {
        yield* refreshIconThemeCache;
      }
    },
    Effect.catch((error) => logWarning("themed icon update failed", { cause: error })),
  );

  const syncIcon = Effect.fn("desktop.linuxUrlHandler.syncIcon")(
    function* (artwork: ForkArtwork) {
      if (environment.platform !== "linux" || !environment.isPackaged) return;
      const png = yield* assets.resolveArtworkIconPath(artwork);
      if (Option.isNone(png)) return;
      yield* syncThemedIcons(png.value);
      // the shell caches GIcons by path, so each artwork needs a distinct Icon= value.
      const iconPath = artworkIconPath(artwork);
      yield* fileSystem.makeDirectory(iconsDir, { recursive: true });
      yield* fileSystem.copyFile(png.value, iconPath);
      yield* writeDesktopEntry(iconPath);
    },
    Effect.catch((error) => logWarning("URL handler icon update failed", { cause: error })),
  );

  const register = Effect.gen(function* () {
    if (environment.platform !== "linux") {
      return;
    }
    if (!environment.isPackaged) {
      yield* writeDesktopEntry(undefined);
      return;
    }

    const settings = yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none()));
    const artwork = Option.getOrElse(settings, () => DEFAULT_CLIENT_SETTINGS).forkArtwork;
    // syncIcon is best-effort and runs first, so a read-only entry still gets its themed icons.
    yield* syncIcon(artwork);
    yield* writeDesktopEntry(artworkIconPath(artwork));

    yield* installThemeIcons;

    yield* updateDesktopDatabase.pipe(
      // Some MIME implementations, including GIO, use mimeinfo.cache to verify
      // that a desktop entry is associated with a scheme. Cache refresh is
      // independently best-effort so a missing update-desktop-database executable
      // does not prevent xdg-mime from recording the requested default.
      Effect.catch((error) =>
        logWarning("desktop MIME cache refresh failed", {
          applicationsDir: environment.linuxApplicationsDir,
          message: error.message,
          ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
        }),
      ),
    );

    yield* setDefaultHandler;
    yield* logInfo("registered URL scheme handler", { scheme });
  }).pipe(
    Effect.catch((error) =>
      logWarning("URL scheme handler registration failed", {
        scheme,
        step: error.step,
        message: error.message,
        ...(error.desktopEntryPath === undefined
          ? {}
          : { desktopEntryPath: error.desktopEntryPath }),
        ...(error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
      }),
    ),
    Effect.withSpan("desktop.linuxUrlHandler.register"),
  );

  return DesktopLinuxUrlHandler.of({ register, syncIcon });
});

export const layer = Layer.effect(DesktopLinuxUrlHandler, make);
