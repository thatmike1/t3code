import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import {
  advanceLiveVoice,
  liveSpokenText,
  type LiveVoiceMessage,
  type LiveVoiceTracker,
} from "~/lib/claudeVoice";
import { speak } from "~/lib/claudeVoicePlayer";
import { selectLiveVoiceEnabled, useLiveVoiceStore } from "~/liveVoiceStore";

/**
 * Queues each assistant message of the open thread for speech as it finishes,
 * while that thread's live voice toggle is on. History is never replayed.
 */
export function useLiveVoice(input: {
  threadRef: ScopedThreadRef | null;
  messages: ReadonlyArray<LiveVoiceMessage>;
  /** The latest turn's id once it has settled, else null. */
  settledTurnId: string | null;
}) {
  const { threadRef, messages, settledTurnId } = input;
  const enabled = useLiveVoiceStore((state) =>
    selectLiveVoiceEnabled(state.byThreadKey, threadRef),
  );
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  const trackerRef = useRef<LiveVoiceTracker | null>(null);

  useEffect(() => {
    const { tracker, toSpeak } = advanceLiveVoice(trackerRef.current, {
      threadKey,
      enabled,
      messages,
      settledTurnId,
      now: Date.now(),
    });
    trackerRef.current = tracker;
    for (const message of toSpeak) {
      speak(liveSpokenText(message.text), { mode: "queue", messageId: message.id });
    }
  }, [enabled, messages, settledTurnId, threadKey]);
}
