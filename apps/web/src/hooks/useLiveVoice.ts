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

/** The part of a timeline entry live voice reads; `TimelineEntry` fits it. */
export interface LiveVoiceTimelineEntry {
  readonly kind: string;
  readonly message?: LiveVoiceMessage;
  readonly projectedItem?: { readonly visibility: string };
}

/**
 * The assistant messages live voice may read: the thread's own projected
 * messages. Entries inherited from a fork's source thread and client-only
 * messages (optimistic sends, local feedback notes) carry no local projected
 * item and are left out.
 */
export function liveVoiceMessagesFromTimeline(
  entries: ReadonlyArray<LiveVoiceTimelineEntry>,
): LiveVoiceMessage[] {
  const messages: LiveVoiceMessage[] = [];
  for (const entry of entries) {
    const { message } = entry;
    if (entry.kind !== "message" || message === undefined || message.role !== "assistant") continue;
    if (entry.projectedItem?.visibility !== "local") continue;
    messages.push(message);
  }
  return messages;
}

/**
 * Queues each assistant message of the open thread for speech as it finishes,
 * while that thread's live voice toggle is on. History is never replayed.
 */
export function useLiveVoice(input: {
  threadRef: ScopedThreadRef | null;
  /** True once the thread's history has loaded and caught up with the server. */
  ready: boolean;
  timelineEntries: ReadonlyArray<LiveVoiceTimelineEntry>;
  /** The latest run's id once it has settled, else null. */
  settledRunId: string | null;
}) {
  const { threadRef, ready, timelineEntries, settledRunId } = input;
  const enabled = useLiveVoiceStore((state) =>
    selectLiveVoiceEnabled(state.byThreadKey, threadRef),
  );
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;
  const messages = liveVoiceMessagesFromTimeline(timelineEntries);
  const trackerRef = useRef<LiveVoiceTracker | null>(null);

  useEffect(() => {
    const { tracker, toSpeak } = advanceLiveVoice(trackerRef.current, {
      threadKey,
      enabled,
      ready,
      messages,
      settledRunId,
      now: Date.now(),
    });
    trackerRef.current = tracker;
    for (const message of toSpeak) {
      speak(liveSpokenText(message.text), { mode: "queue", messageId: message.id });
    }
  }, [enabled, messages, ready, settledRunId, threadKey]);
}
