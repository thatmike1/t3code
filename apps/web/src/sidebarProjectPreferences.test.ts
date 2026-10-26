import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildHomeProjectMenuItems,
  buildSidebarMachineFilterOptions,
  CLEAR_HOME_PROJECT_ITEM_ID,
  homeProjectMenuItemId,
  buildSidebarProjectScopeMenu,
  isFavouriteProjectGroup,
  OTHER_PROJECTS_TOGGLE_VALUE,
  orderFavouriteProjectGroupsFirst,
  resolveEffectiveSidebarProjectSortOrder,
  resolveHomeProject,
  toggleSidebarMachineFilter,
} from "./sidebarProjectPreferences";

const desktop = EnvironmentId.make("env-desktop");
const vps = EnvironmentId.make("env-vps");
const laptop = EnvironmentId.make("env-laptop");

function group(projectKey: string, ...physicalProjectKeys: string[]) {
  return {
    projectKey,
    displayName: projectKey,
    memberProjects: physicalProjectKeys.map((physicalProjectKey) => ({ physicalProjectKey })),
  };
}

const ccChat = group("ccChat", "env-desktop:/git/ccchat", "env-vps:/srv/ccchat");
const t3code = group("t3code", "env-desktop:/git/t3code");
const oneOffA = group("one-off-a", "env-vps:/jobs/a");
const oneOffB = group("one-off-b", "env-vps:/jobs/b");
const groups = [oneOffA, ccChat, oneOffB, t3code];

const labelMatches = (item: { label: string }, query: string) =>
  item.label.toLowerCase().includes(query.toLowerCase());

function menu(input: {
  favouriteKeys: string[];
  otherExpanded?: boolean;
  selectedKey?: string | null;
  query?: string;
}) {
  return buildSidebarProjectScopeMenu({
    groups,
    favouriteKeys: new Set(input.favouriteKeys),
    otherExpanded: input.otherExpanded ?? false,
    selectedKey: input.selectedKey ?? null,
    query: input.query ?? "",
    matches: labelMatches,
  });
}

describe("favourite project groups", () => {
  it("treats a grouped repo as favourite when any one of its checkouts is", () => {
    expect(isFavouriteProjectGroup(ccChat, new Set(["env-vps:/srv/ccchat"]))).toBe(true);
    expect(isFavouriteProjectGroup(ccChat, new Set(["env-vps:/jobs/a"]))).toBe(false);
  });

  it("moves favourites to the front without reordering either bucket", () => {
    const ordered = orderFavouriteProjectGroupsFirst(
      groups,
      new Set(["env-desktop:/git/t3code", "env-desktop:/git/ccchat"]),
    );
    expect(ordered.map((entry) => entry.projectKey)).toEqual([
      "ccChat",
      "t3code",
      "one-off-a",
      "one-off-b",
    ]);
  });
});

describe("buildSidebarProjectScopeMenu", () => {
  it("lists every project plainly until the first favourite exists", () => {
    const { visibleItems } = menu({ favouriteKeys: [] });
    expect(visibleItems.map((item) => item.value)).toEqual([
      "all",
      "one-off-a",
      "ccChat",
      "one-off-b",
      "t3code",
    ]);
  });

  it("folds the rest under Other projects once favourites exist", () => {
    const { items, visibleItems } = menu({
      favouriteKeys: ["env-desktop:/git/ccchat", "env-desktop:/git/t3code"],
    });
    expect(visibleItems.map((item) => item.value)).toEqual([
      "all",
      "ccChat",
      "t3code",
      OTHER_PROJECTS_TOGGLE_VALUE,
    ]);
    expect(visibleItems.at(-1)).toMatchObject({ label: "Other projects (2)", expanded: false });
    // the full item list still knows the folded projects, so a stored scope resolves.
    expect(items.map((item) => item.value)).toContain("one-off-b");
  });

  it("shows the folded projects when expanded", () => {
    const { visibleItems } = menu({
      favouriteKeys: ["env-desktop:/git/ccchat"],
      otherExpanded: true,
    });
    expect(visibleItems.map((item) => item.value)).toEqual([
      "all",
      "ccChat",
      OTHER_PROJECTS_TOGGLE_VALUE,
      "one-off-a",
      "one-off-b",
      "t3code",
    ]);
  });

  it("keeps the selected project visible while Other is folded", () => {
    const { visibleItems } = menu({
      favouriteKeys: ["env-desktop:/git/ccchat"],
      selectedKey: "one-off-b",
    });
    expect(visibleItems.map((item) => item.value)).toEqual([
      "all",
      "ccChat",
      OTHER_PROJECTS_TOGGLE_VALUE,
      "one-off-b",
    ]);
  });

  it("searches folded projects too, favourites first", () => {
    const { visibleItems } = menu({
      favouriteKeys: ["env-desktop:/git/t3code"],
      query: "o",
    });
    expect(visibleItems.map((item) => item.value)).toEqual(["t3code", "one-off-a", "one-off-b"]);
  });
});

describe("resolveEffectiveSidebarProjectSortOrder", () => {
  it("sorts a leftover manual order by activity outside the legacy sidebar", () => {
    expect(resolveEffectiveSidebarProjectSortOrder("manual", false)).toBe("updated_at");
    expect(resolveEffectiveSidebarProjectSortOrder("manual", true)).toBe("manual");
    expect(resolveEffectiveSidebarProjectSortOrder("created_at", false)).toBe("created_at");
  });
});

describe("sidebar machine filter", () => {
  const all = [desktop, vps, laptop];

  it("narrows from all machines by unchecking one", () => {
    expect(
      toggleSidebarMachineFilter({
        selected: null,
        allEnvironmentIds: all,
        environmentId: laptop,
        checked: false,
      }),
    ).toEqual([desktop, vps]);
  });

  it("returns to all machines once every machine is checked again", () => {
    expect(
      toggleSidebarMachineFilter({
        selected: [desktop, vps],
        allEnvironmentIds: all,
        environmentId: laptop,
        checked: true,
      }),
    ).toBeNull();
  });

  it("refuses to uncheck the last machine", () => {
    const selected = [desktop];
    expect(
      toggleSidebarMachineFilter({
        selected,
        allEnvironmentIds: all,
        environmentId: desktop,
        checked: false,
      }),
    ).toBe(selected);
  });

  it("keeps a selected machine listed while it is offline, primary first", () => {
    const options = buildSidebarMachineFilterOptions({
      environments: [
        { environmentId: vps, label: "VPS" },
        { environmentId: desktop, label: "Desktop" },
      ],
      primaryEnvironmentId: desktop,
      connectedEnvironmentIds: [desktop],
      selected: [laptop],
    });
    expect(options).toEqual([
      { environmentId: desktop, label: "Desktop", isPrimary: true, connected: true },
      { environmentId: vps, label: "VPS", isPrimary: false, connected: false },
      { environmentId: laptop, label: laptop, isPrimary: false, connected: false },
    ]);
  });
});

describe("resolveHomeProject", () => {
  const projects = [
    { id: "p-desktop", environmentId: desktop, key: "env-desktop:/git/ccchat" },
    { id: "p-vps", environmentId: vps, key: "env-vps:/git/ccchat" },
  ];
  const resolve = (key: string | null, connected = [desktop, vps]) =>
    resolveHomeProject({
      home: key === null ? null : { key, label: "ccChat on Desktop" },
      projects,
      projectKey: (project) => project.key,
      connectedEnvironmentIds: connected,
    });

  it("picks the exact checkout even when the same path exists on another machine", () => {
    expect(resolve("env-vps:/git/ccchat")).toEqual({ status: "ready", project: projects[1] });
  });

  it("reports an unset, missing or offline home instead of falling back", () => {
    expect(resolve(null)).toEqual({ status: "unset" });
    expect(resolve("env-laptop:/git/ccchat")).toEqual({
      status: "missing",
      label: "ccChat on Desktop",
    });
    expect(resolve("env-desktop:/git/ccchat", [vps])).toEqual({
      status: "offline",
      project: projects[0],
    });
  });
});

describe("buildHomeProjectMenuItems", () => {
  const desktopMember = {
    physicalProjectKey: "env-desktop:/git/ccchat",
    environmentId: desktop,
    environmentLabel: "Desktop",
  };
  const vpsMember = {
    physicalProjectKey: "env-vps:/srv/ccchat",
    environmentId: vps,
    environmentLabel: "VPS",
  };

  it("offers set or clear for a single checkout", () => {
    expect(
      buildHomeProjectMenuItems({
        members: [desktopMember],
        homeKey: null,
        primaryEnvironmentId: desktop,
      }),
    ).toEqual([
      { id: homeProjectMenuItemId(desktopMember.physicalProjectKey), label: "Set as home project" },
    ]);
    expect(
      buildHomeProjectMenuItems({
        members: [desktopMember],
        homeKey: desktopMember.physicalProjectKey,
        primaryEnvironmentId: desktop,
      }),
    ).toEqual([{ id: CLEAR_HOME_PROJECT_ITEM_ID, label: "Clear home project" }]);
  });

  it("asks which machine's checkout of a grouped repo, this machine first", () => {
    const [choose, clear] = buildHomeProjectMenuItems({
      members: [vpsMember, desktopMember],
      homeKey: vpsMember.physicalProjectKey,
      primaryEnvironmentId: desktop,
    });
    expect(choose?.children).toEqual([
      {
        id: homeProjectMenuItemId(desktopMember.physicalProjectKey),
        label: "Desktop",
        checked: false,
      },
      { id: homeProjectMenuItemId(vpsMember.physicalProjectKey), label: "VPS", checked: true },
    ]);
    expect(clear?.id).toBe(CLEAR_HOME_PROJECT_ITEM_ID);
  });
});
