import type { ContextMenuItem, EnvironmentId, SidebarProjectSortOrder } from "@t3tools/contracts";

export const OTHER_PROJECTS_TOGGLE_VALUE = "\0other-projects";

interface FavouriteCandidate {
  readonly memberProjects: ReadonlyArray<{ readonly physicalProjectKey: string }>;
}

// a grouped repo is one favourite row when any of its checkouts is a favourite.
export function isFavouriteProjectGroup(
  group: FavouriteCandidate,
  favouriteKeys: ReadonlySet<string>,
): boolean {
  return group.memberProjects.some((member) => favouriteKeys.has(member.physicalProjectKey));
}

// stable: each bucket keeps the order the caller sorted it in.
function partitionFavouriteProjectGroups<TGroup extends FavouriteCandidate>(
  groups: readonly TGroup[],
  favouriteKeys: ReadonlySet<string>,
): { readonly favourites: TGroup[]; readonly others: TGroup[] } {
  const favourites: TGroup[] = [];
  const others: TGroup[] = [];
  for (const group of groups) {
    (isFavouriteProjectGroup(group, favouriteKeys) ? favourites : others).push(group);
  }
  return { favourites, others };
}

export function orderFavouriteProjectGroupsFirst<TGroup extends FavouriteCandidate>(
  groups: readonly TGroup[],
  favouriteKeys: ReadonlySet<string>,
): TGroup[] {
  const { favourites, others } = partitionFavouriteProjectGroups(groups, favouriteKeys);
  return favourites.length === 0 ? [...groups] : [...favourites, ...others];
}

// the V2 sidebar has no way to set a manual order, so a stored "manual" value
// (left over from the legacy sidebar) sorts by activity there instead.
export function resolveEffectiveSidebarProjectSortOrder(
  sortOrder: SidebarProjectSortOrder,
  legacySidebarEnabled: boolean,
): SidebarProjectSortOrder {
  return sortOrder === "manual" && !legacySidebarEnabled ? "updated_at" : sortOrder;
}

export type SidebarProjectScopeItem =
  | { readonly kind: "all"; readonly value: "all"; readonly label: string }
  | {
      readonly kind: "project";
      readonly value: string;
      readonly label: string;
      readonly favourite: boolean;
    }
  | {
      readonly kind: "other-toggle";
      readonly value: typeof OTHER_PROJECTS_TOGGLE_VALUE;
      readonly label: string;
      readonly expanded: boolean;
    };

export function buildSidebarProjectScopeMenu<
  TGroup extends FavouriteCandidate & { readonly projectKey: string; readonly displayName: string },
>(input: {
  readonly groups: readonly TGroup[];
  readonly favouriteKeys: ReadonlySet<string>;
  readonly otherExpanded: boolean;
  readonly selectedKey: string | null;
  readonly query: string;
  readonly matches: (item: SidebarProjectScopeItem, query: string) => boolean;
}): {
  readonly items: readonly SidebarProjectScopeItem[];
  readonly visibleItems: readonly SidebarProjectScopeItem[];
} {
  const all: SidebarProjectScopeItem = { kind: "all", value: "all", label: "All projects" };
  const { favourites, others } = partitionFavouriteProjectGroups(input.groups, input.favouriteKeys);
  const toItem = (group: TGroup, favourite: boolean): SidebarProjectScopeItem => ({
    kind: "project",
    value: group.projectKey,
    label: group.displayName,
    favourite,
  });
  const favouriteItems = favourites.map((group) => toItem(group, true));
  const otherItems = others.map((group) => toItem(group, false));
  const projectItems = [...favouriteItems, ...otherItems];
  const query = input.query.trim();
  if (query.length > 0) {
    // search reaches folded projects too.
    const matching = projectItems.filter((item) => input.matches(item, query));
    return { items: [all, ...projectItems], visibleItems: matching };
  }
  // nothing to fold until the first favourite exists.
  if (favouriteItems.length === 0 || otherItems.length === 0) {
    const items = [all, ...projectItems];
    return { items, visibleItems: items };
  }
  const toggle: SidebarProjectScopeItem = {
    kind: "other-toggle",
    value: OTHER_PROJECTS_TOGGLE_VALUE,
    label: `Other projects (${otherItems.length})`,
    expanded: input.otherExpanded,
  };
  const items = [all, ...favouriteItems, toggle, ...otherItems];
  const visibleOthers = input.otherExpanded
    ? otherItems
    : otherItems.filter((item) => item.value === input.selectedKey);
  return { items, visibleItems: [all, ...favouriteItems, toggle, ...visibleOthers] };
}

export interface SidebarMachineFilterOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
  readonly connected: boolean;
}

// a disconnected machine stays listed, so a filter that names it never widens
// silently while it reconnects.
export function buildSidebarMachineFilterOptions(input: {
  readonly environments: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly selected: readonly EnvironmentId[] | null;
}): SidebarMachineFilterOption[] {
  const connected = new Set(input.connectedEnvironmentIds);
  const options = input.environments.map((environment) => ({
    environmentId: environment.environmentId,
    label: environment.label,
    isPrimary: environment.environmentId === input.primaryEnvironmentId,
    connected: connected.has(environment.environmentId),
  }));
  const known = new Set(options.map((option) => option.environmentId));
  for (const environmentId of input.selected ?? []) {
    if (known.has(environmentId)) continue;
    options.push({ environmentId, label: environmentId, isPrimary: false, connected: false });
  }
  return options.sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
}

// null means every machine. Unchecking the last selected machine keeps it,
// because an empty filter would just hide every thread.
export function toggleSidebarMachineFilter(input: {
  readonly selected: readonly EnvironmentId[] | null;
  readonly allEnvironmentIds: readonly EnvironmentId[];
  readonly environmentId: EnvironmentId;
  readonly checked: boolean;
}): readonly EnvironmentId[] | null {
  const current = input.selected ?? input.allEnvironmentIds;
  const next = input.checked
    ? [...new Set([...current, input.environmentId])]
    : current.filter((id) => id !== input.environmentId);
  if (next.length === 0) return input.selected;
  const all = new Set(input.allEnvironmentIds);
  return next.length >= all.size && [...all].every((id) => next.includes(id)) ? null : next;
}

export interface HomeProjectPreference {
  // physical project key: one exact checkout on one machine.
  readonly key: string;
  // shown when that checkout cannot be reached, since its project is unknown then.
  readonly label: string;
}

export type HomeProjectResolution<TProject> =
  | { readonly status: "unset" }
  | { readonly status: "ready"; readonly project: TProject }
  | { readonly status: "offline"; readonly project: TProject }
  | { readonly status: "missing"; readonly label: string };

// never falls back to another project: a missing home is reported, not guessed.
export function resolveHomeProject<
  TProject extends { readonly environmentId: EnvironmentId },
>(input: {
  readonly home: HomeProjectPreference | null;
  readonly projects: readonly TProject[];
  readonly projectKey: (project: TProject) => string;
  readonly connectedEnvironmentIds: ReadonlyArray<EnvironmentId>;
}): HomeProjectResolution<TProject> {
  const { home } = input;
  if (home === null) return { status: "unset" };
  const project = input.projects.find((candidate) => input.projectKey(candidate) === home.key);
  if (project === undefined) return { status: "missing", label: home.label };
  return input.connectedEnvironmentIds.includes(project.environmentId)
    ? { status: "ready", project }
    : { status: "offline", project };
}

export const CLEAR_HOME_PROJECT_ITEM_ID = "home:clear";

export function homeProjectMenuItemId(physicalProjectKey: string): string {
  return `home:set:${physicalProjectKey}`;
}

// a grouped repo has one checkout per machine, so home names which one; this
// machine's checkout comes first and nothing is picked on the user's behalf.
export function buildHomeProjectMenuItems(input: {
  readonly members: ReadonlyArray<{
    readonly physicalProjectKey: string;
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string | null;
  }>;
  readonly homeKey: string | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): ContextMenuItem<string>[] {
  const isHome = input.members.some((member) => member.physicalProjectKey === input.homeKey);
  const clear: ContextMenuItem<string>[] = isHome
    ? [{ id: CLEAR_HOME_PROJECT_ITEM_ID, label: "Clear home project" }]
    : [];
  const [onlyMember] = input.members;
  if (input.members.length === 1 && onlyMember) {
    return isHome
      ? clear
      : [
          {
            id: homeProjectMenuItemId(onlyMember.physicalProjectKey),
            label: "Set as home project",
          },
        ];
  }
  const members = input.members.toSorted(
    (left, right) =>
      Number(right.environmentId === input.primaryEnvironmentId) -
      Number(left.environmentId === input.primaryEnvironmentId),
  );
  return [
    {
      id: "home:choose",
      label: "Set as home project",
      children: members.map((member) => ({
        id: homeProjectMenuItemId(member.physicalProjectKey),
        label: member.environmentLabel ?? member.physicalProjectKey,
        checked: member.physicalProjectKey === input.homeKey,
      })),
    },
    ...clear,
  ];
}
