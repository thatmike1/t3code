import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const stopSpeaking = vi.fn();
vi.mock("./lib/claudeVoicePlayer", () => ({ stopSpeaking }));

const { selectLiveVoiceEnabled, useLiveVoiceStore } = await import("./liveVoiceStore");

const THREAD_A = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-a"));
const THREAD_B = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-b"));

describe("liveVoiceStore", () => {
  beforeEach(() => {
    useLiveVoiceStore.setState({ byThreadKey: {} });
    stopSpeaking.mockClear();
  });

  it("is off by default and toggles per thread", () => {
    const { setLiveVoice } = useLiveVoiceStore.getState();
    expect(selectLiveVoiceEnabled(useLiveVoiceStore.getState().byThreadKey, THREAD_A)).toBe(false);
    setLiveVoice(THREAD_A, true);
    const { byThreadKey } = useLiveVoiceStore.getState();
    expect(selectLiveVoiceEnabled(byThreadKey, THREAD_A)).toBe(true);
    expect(selectLiveVoiceEnabled(byThreadKey, THREAD_B)).toBe(false);
    expect(selectLiveVoiceEnabled(byThreadKey, null)).toBe(false);
  });

  it("stops playback when switched off and stores nothing for off threads", () => {
    const { setLiveVoice } = useLiveVoiceStore.getState();
    setLiveVoice(THREAD_A, true);
    expect(stopSpeaking).not.toHaveBeenCalled();
    setLiveVoice(THREAD_A, false);
    expect(stopSpeaking).toHaveBeenCalledTimes(1);
    expect(useLiveVoiceStore.getState().byThreadKey).toEqual({});
  });
});
