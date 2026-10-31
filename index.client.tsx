import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentBoardScreen, OpenAgentScreen } from "./client/board";
import { BOARD_SCREEN, OPEN_AGENT_SCREEN, WORKSPACES_SCREEN } from "./client/navigation";
import { RosterSettingsScreen } from "./client/settings-screen";
import { AgentBoardSidebarItem } from "./client/sidebar";
import { boardStore } from "./client/store";
import {
  assistantMessageImageTransformer,
  timelineImageRendererContribution,
  toolCallImageTransformer,
} from "./client/timeline-images";
import { WorkspacesScreen } from "./client/workspaces-screen";
import { workspaceStore } from "./client/workspaces";
import { checkInLeadsRpc, createBrainstormRpc } from "./shared/brainstorm";
import { DEFAULT_CONFIG, isBrainstormAgent, normalizePath } from "./shared/config";
import { promoteLeadRpc } from "./shared/handoff";

export default function contribute(client: PluginClientContext) {
  boardStore.start(client.paseo, client.rpc);
  workspaceStore.start(client.paseo);
  client.addTimelineRenderer(timelineImageRendererContribution);
  client.addTimelineTransformer(toolCallImageTransformer);
  client.addTimelineTransformer(assistantMessageImageTransformer);
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
  client.addCommandCenterItem({
    id: "brainstorm-here",
    title: "Brainstorm here / Open brainstorm",
    icon: "Sparkles",
    context: "workspace",
    keywords: ["brainstorm", "open brainstorm", "riff", "lead", "chat"],
    async onSelect({ workspace, rpc, openScreen }) {
      const cwdNorm = normalizePath(workspace.directory);
      for (const agent of boardStore.getSnapshot().agents.values()) {
        if (agent.archivedAt || agent.status === "closed") continue;
        if (!isBrainstormAgent(agent.title, agent.labels, DEFAULT_CONFIG)) continue;
        if (agent.workspaceId === workspace.id || normalizePath(agent.cwd) === cwdNorm) {
          openScreen({ screenId: OPEN_AGENT_SCREEN, params: { agentId: agent.id } });
          return;
        }
      }
      const result = await rpc(createBrainstormRpc, {
        cwd: workspace.directory,
        workspaceId: workspace.id,
        workspaceName: workspace.title ?? workspace.name,
        projectDisplayName: workspace.projectDisplayName,
        projectRootPath: workspace.projectRootPath,
        reuseExisting: true,
      });
      if (!result.ok) throw new Error(result.message);
      if (result.agentId) {
        openScreen({ screenId: OPEN_AGENT_SCREEN, params: { agentId: result.agentId } });
      }
    },
  });
  client.addSlashCommand({
    name: "check-in",
    description: "Ask idle leads without a brainstorm if they have anything for Aub",
    argumentHint: "",
    context: "workspace",
    async onSubmit({ rpc }) {
      const result = await rpc(checkInLeadsRpc, {});
      if (!result.ok) throw new Error(result.message);
    },
  });
  client.addCommandCenterItem({
    id: "check-in-leads",
    title: "Roster: check in with idle leads",
    icon: "MessageSquare",
    context: "global",
    keywords: ["needs-aub", "waiting", "leads", "brainstorm", "check in"],
    async onSelect({ rpc }) {
      const result = await rpc(checkInLeadsRpc, {});
      if (!result.ok) throw new Error(result.message);
    },
  });
  return async () => {
    await Promise.all([boardStore.stop(), workspaceStore.stop()]);
  };
}
