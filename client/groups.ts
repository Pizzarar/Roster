import { useMemo, useSyncExternalStore } from "react";
import { agentGroupLabel, groupByLabel, type BoardConfig, type Grouped } from "../shared/config";
import { agentKind, compareAgents, type BoardAgent } from "./model";

/** Label that may carry the profile name an agent was started from. */
export const PROFILE_LABEL = "profile";

/** Live agents grouped by role / name prefix, in the configured group order. */
export function liveAgentGroups(agents: Iterable<BoardAgent>, cfg: BoardConfig): Grouped<BoardAgent>[] {
  const live = [...agents].filter((agent) => !agent.archivedAt && agent.status !== "closed").sort(compareAgents);
  return groupByLabel(
    live,
    (agent) =>
      agentGroupLabel({
        kind: agentKind(agent, cfg),
        profileName: agent.labels[PROFILE_LABEL],
        title: agent.title,
      }),
    cfg.groupOrder,
  );
}

/** Group collapse state: in memory for the session, shared by every screen. Groups start collapsed. */
const expanded = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function toggleGroup(id: string) {
  if (!expanded.delete(id)) expanded.add(id);
  version += 1;
  for (const listener of listeners) listener();
}

/** `isOpen(id)` for collapsible groups; `defaultOpen` groups start open. */
export function useGroupState(defaultOpen = false) {
  const current = useSyncExternalStore(subscribe, () => version, () => version);
  return useMemo(
    () => ({
      isOpen: (id: string) => (defaultOpen ? !expanded.has(`closed:${id}`) : expanded.has(id)),
      toggle: (id: string) => toggleGroup(defaultOpen ? `closed:${id}` : id),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, defaultOpen],
  );
}
