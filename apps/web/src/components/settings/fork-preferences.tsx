import { useState } from "react";

import { useClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const SECTION_NOTE_CLASSNAME = "px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4";

/** edits fork preferences stored for this client, separately from shortcut keys. */
export function ForkPreferences() {
  const settings = useClientSettings();
  const update = updateClientSettings;
  const [prefix, setPrefix] = useState("");
  const [origin, setOrigin] = useState("");
  const [boardError, setBoardError] = useState("");

  const saveBoard = () => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(prefix.trim())) {
        setBoardError("Enter the full issue prefix, such as nexiflow.");
        return;
      }
      const url = new URL(origin.trim());
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      ) {
        setBoardError("Enter a board origin, such as http://127.0.0.1:1339.");
        return;
      }
      void update({
        beadBoards: [
          ...settings.beadBoards.filter((board) => board.prefix !== prefix.trim()),
          { prefix: prefix.trim(), origin: url.origin },
        ],
      }).catch(() => setBoardError("Could not save the board."));
      setPrefix("");
      setOrigin("");
      setBoardError("");
    } catch (cause) {
      setBoardError(
        cause instanceof TypeError
          ? "Enter a valid URL, such as http://127.0.0.1:1339."
          : cause instanceof Error
            ? cause.message
            : "Invalid board.",
      );
    }
  };

  return (
    <>
      <SettingsSection title="Beadside boards">
        <p className={SECTION_NOTE_CLASSNAME}>
          Map each repository's full issue prefix to its running board, at a URL reachable from this
          device. Short IDs link only when every configured board answers and the suffix is unique.
        </p>
        {settings.beadBoards.map((board) => (
          <SettingsRow
            key={board.prefix}
            title={board.prefix}
            description={board.origin}
            control={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void update({
                    beadBoards: settings.beadBoards.filter((item) => item.prefix !== board.prefix),
                  }).catch(() => setBoardError("Could not remove the board."))
                }
              >
                Remove
              </Button>
            }
          />
        ))}
        <SettingsRow
          title="Add board"
          description="Saving an existing prefix replaces its URL."
          status={
            boardError ? (
              <span role="alert" className="text-destructive">
                {boardError}
              </span>
            ) : undefined
          }
          control={
            <form
              className="flex w-full flex-wrap items-center justify-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                saveBoard();
              }}
            >
              <Input
                size="sm"
                className="w-32"
                aria-label="Bead issue prefix"
                placeholder="nexiflow"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
              <Input
                size="sm"
                className="w-52"
                aria-label="Beadside board URL"
                placeholder="http://127.0.0.1:1339"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              />
              <Button size="sm" type="submit">
                Save
              </Button>
            </form>
          }
        />
      </SettingsSection>
    </>
  );
}
