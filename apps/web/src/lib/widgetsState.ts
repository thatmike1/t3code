import type { WidgetsSnapshot } from "@t3tools/contracts";

import { usePrimaryEnvironment } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { serverEnvironment } from "../state/server";

/** The primary environment's widget set, or null while it has not arrived. */
export function useWidgets(): WidgetsSnapshot | null {
  const primaryEnvironment = usePrimaryEnvironment();
  const environmentId = primaryEnvironment?.environmentId ?? null;
  const query = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.widgets({ environmentId, input: {} }),
  );
  return query.data;
}
