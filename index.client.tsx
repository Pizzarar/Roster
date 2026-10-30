import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentBoardScreen, OpenAgentScreen } from "./client/board";
import { BOARD_SCREEN, OPEN_AGENT_SCREEN, WORKSPACES_SCREEN } from "./client/navigation";
import { RosterSettingsScreen } from "./client/settings-screen";
import { AgentBoardSidebarItem } from "./client/sidebar";
import { boardStore } from "./client/store";
import { WorkspacesScreen } from "./client/workspaces-screen";
import { workspaceStore } from "./client/workspaces";
import { promoteLeadRpc } from "./shared/handoff";

export default function contribute(client: PluginClientContext) {
  boardStore.start(client.paseo, client.rpc);
  workspaceStore.start(client.paseo);
  client.addScreen({ id: WORKSPACES_SCREEN, title: "Workspaces", Component: WorkspacesScreen });
  client.addScreen({ id: BOARD_SCREEN, title: "Roster", Component: AgentBoardScreen });
  client.addScreen({ id: OPEN_AGENT_SCREEN, title: "Open agent", Component: OpenAgentScreen });
  client.addSidebarHeaderItem({ id: "roster", title: "Roster", Component: AgentBoardSidebarItem });
  client.addSettingsScreen({ id: "settings", title: "Roster", icon: "LayoutList", Component: RosterSettingsScreen });
  client.addCommandCenterItem({
    id: "open-roster",
    title: "Open Roster",
    icon: "LayoutList",
    context: "global",
    keywords: ["agents", "leads", "worktrees", "board"],
    onSelect({ openScreen }) {
      openScreen({ screenId: BOARD_SCREEN });
    },
  });
  client.addCommandCenterItem({
    id: "roster-settings",
    title: "Roster settings",
    icon: "Settings",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("settings");
    },
  });
  client.addCommandCenterItem({
    id: "open-workspaces",
    title: "Roster: workspaces and cleanup",
    icon: "FolderTree",
    context: "global",
    keywords: ["clean", "archive", "worktrees", "sort", "stale"],
    onSelect({ openScreen }) {
      openScreen({ screenId: WORKSPACES_SCREEN });
    },
  });
  client.addCommandCenterItem({
    id: "promote-lead",
    title: "Roster: promote to lead (detach from spawner, take over its workers)",
    icon: "Crown",
    context: "agent",
    keywords: ["handoff", "detach", "successor", "lead"],
    async onSelect({ agent, rpc, openScreen }) {
      const result = await rpc(promoteLeadRpc, { agentId: agent.id });
      if (!result.ok) throw new Error(result.message);
      void boardStore.refreshHandoffs();
      openScreen({ screenId: BOARD_SCREEN });
    },
  });
  return async () => {
    await Promise.all([boardStore.stop(), workspaceStore.stop()]);
  };
}