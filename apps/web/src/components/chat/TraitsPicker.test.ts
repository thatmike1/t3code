import { describe, expect, it } from "vite-plus/test";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { stepEffortDescriptors } from "./TraitsPicker";
const CONTEXT_WINDOW: ProviderOptionDescriptor = {
  id: "contextWindow",
  label: "Context",
  type: "select",
  options: [{ id: "default", label: "Default" }],
  currentValue: "default",
};
const EFFORT: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Effort",
  type: "select",
  options: [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  currentValue: "high",
};
const fastModeDescriptor = (currentValue: boolean): ProviderOptionDescriptor => ({
  id: "fastMode",
  label: "Fast",
  type: "boolean",
  currentValue,
});

describe("stepEffortDescriptors", () => {
  const claudeEffort = (currentValue: string): ProviderOptionDescriptor => ({
    id: "effort",
    label: "Effort",
    type: "select",
    options: ["low", "medium", "high", "xhigh", "max", "ultracode", "ultrathink"].map((id) => ({
      id,
      label: id,
      ...(id === "high" ? { isDefault: true } : {}),
    })),
    currentValue,
    promptInjectedValues: ["ultrathink"],
  });
  const effortOf = (descriptors: ReadonlyArray<ProviderOptionDescriptor> | null) =>
    descriptors?.find((descriptor) => descriptor.id === "effort")?.currentValue ?? null;

  it("steps one level down and up", () => {
    expect(effortOf(stepEffortDescriptors([claudeEffort("high")], -1))).toBe("medium");
    expect(effortOf(stepEffortDescriptors([claudeEffort("high")], 1))).toBe("xhigh");
  });

  it("clamps at the lowest level and below the modes at the top", () => {
    expect(stepEffortDescriptors([claudeEffort("low")], -1)).toBeNull();
    expect(stepEffortDescriptors([claudeEffort("max")], 1)).toBeNull();
  });

  it("steps down from a mode to the highest level", () => {
    expect(effortOf(stepEffortDescriptors([claudeEffort("ultracode")], -1))).toBe("max");
    expect(stepEffortDescriptors([claudeEffort("ultracode")], 1)).toBeNull();
  });

  it("finds the effort descriptor by id and leaves the others alone", () => {
    const next = stepEffortDescriptors([CONTEXT_WINDOW, EFFORT, fastModeDescriptor(true)], 1);
    expect(next).toEqual([
      CONTEXT_WINDOW,
      { ...EFFORT, currentValue: "max" },
      fastModeDescriptor(true),
    ]);
  });

  it("does nothing for a model without an effort descriptor", () => {
    expect(stepEffortDescriptors([CONTEXT_WINDOW, fastModeDescriptor(false)], 1)).toBeNull();
  });
});
