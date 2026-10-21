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
// prompting "Choose an application" for every OAuth callback. Instead, write
// our own handler entry pointing at the current AppImage, refresh the desktop
// MIME cache so desktop environments recognize that entry as a handler, and
// use xdg-mime to record it as the scheme default in mimeapps.list.
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
// layers in reverse. The argument is double-quoted with reserved characters
// backslash-escaped and literal percent signs doubled (field codes), and the
// general string escaping is applied on top: a literal backslash ends up as
// four backslashes in the file, a quote as \\", a dollar sign as \\$.
export function escapeDesktopEntryExecArgument(value: string): string {
  const quoted = value
    .replaceAll("\\", () => "\\\\")
    .replaceAll("`", () => "\\`")
    .replaceAll("$", () => "\\$")
    .replaceAll('"', () => '\\"')
    .replaceAll("%", () => "%%");
  return escapeDesktopEntryString(`"${quoted}"`);
}

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
    `Exec=${escapeDesktopEntryExecArgument(input.execTarget)} %U`,
    ...(input.iconPath === undefined ? [] : [`Icon=${escapeDesktopEntryString(input.iconPath)}`]),
    "Terminal=false",
    "NoDisplay=true",
    "StartupNotify=false",
    `MimeType=x-scheme-handler/${input.scheme};`,
    "",
  ].join("\n");
}

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

  const writeDesktopEntry = (iconPath?: string) =>
    Effect.gen(function* () {
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
    }).pipe(
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
  const hicolorDir = environment.path.join(iconsDir, "hicolor");
  const themedIconNames = [
    environment.linuxDesktopEntryName.replace(/\.desktop$/, ""),
    environment.linuxWmClass,
  ];

  const refreshIconThemeCache = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make("gtk-update-icon-cache", ["-f", "-t", hicolorDir], {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      );
      yield* handle.exitCode.pipe(Effect.timeout("5 seconds"));
    }),
  );

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
      yield* writeDesktopEntry();
      return;
    }

    const settings = yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none()));
    const artwork = Option.getOrElse(settings, () => DEFAULT_CLIENT_SETTINGS).forkArtwork;
    // syncIcon is best-effort and runs first, so a read-only entry still gets its themed icons.
    yield* syncIcon(artwork);
    yield* writeDesktopEntry(artworkIconPath(artwork));

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
    // Registration is best-effort: a missing xdg-mime or read-only home must
    // never block startup — the OS chooser remains as fallback.
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
