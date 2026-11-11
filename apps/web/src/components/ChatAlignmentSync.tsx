import { useEffect } from "react";

import { useClientSettings } from "../hooks/useSettings";

/**
 * mirrors the chat alignment settings onto the document root, where the
 * left-alignment rules in index.css read them (like `data-chat-width`).
 */
export function ChatAlignmentSync() {
  const chatAlignment = useClientSettings((settings) => settings.chatAlignment);
  const chatLeftGutter = useClientSettings((settings) => settings.chatLeftGutter);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the setting onto the document root's data attribute
  useEffect(() => {
    document.documentElement.dataset.chatAlignment = chatAlignment;
  }, [chatAlignment]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors the setting onto a CSS variable on the document root
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-left-gutter", `${chatLeftGutter}px`);
  }, [chatLeftGutter]);

  return null;
}
