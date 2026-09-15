import { useEffect } from "react";

import { useClientSettings } from "../hooks/useSettings";

/**
 * mirrors the chat alignment settings onto the document root, where the
 * left-alignment rules in index.css read them (like `data-chat-width`).
 */
export function ChatAlignmentSync() {
  const chatAlignment = useClientSettings((settings) => settings.chatAlignment);
  const chatLeftGutter = useClientSettings((settings) => settings.chatLeftGutter);

  useEffect(() => {
    document.documentElement.dataset.chatAlignment = chatAlignment;
  }, [chatAlignment]);

  useEffect(() => {
    document.documentElement.style.setProperty("--chat-left-gutter", `${chatLeftGutter}px`);
  }, [chatLeftGutter]);

  return null;
}
