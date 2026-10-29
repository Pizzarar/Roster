import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AgentBoardScreen, OpenAgentScreen } from "./client/board";
import { BOARD_SCREEN, OPEN_AGENT_SCREEN } from "./client/navigation";
import { RosterSettingsScreen } from "./client/settings-screen";
import { AgentBoardSidebarItem } from "./client/sidebar";
import { boardStore } from "./client/store";

export default function contribute(client: PluginClientContext) {
  boardStore.start(client.paseo);
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
  return () => boardStore.stop();
}