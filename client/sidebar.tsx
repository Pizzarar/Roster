import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow, SidebarSeparator } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { View } from "react-native";
import { useBoardConfig } from "./config";
import { agentKind, compareAgents, sidebarTitle, type BoardAgent } from "./model";
import { BOARD_SCREEN, OPEN_AGENT_SCREEN, navigationOf } from "./navigation";
import { useBoard, useSubagentWatch } from "./store";
import { attentionLabel, Chip, dotIcon, statusColor, subagentLabel } from "./ui";

export function AgentBoardSidebarItem(props: PluginSidebarItemProps) {
  const { theme, currentScreen, openScreen } = props;
  const board = useBoard();
  const cfg = useBoardConfig();
  const { leads, brainstorm, running } = useMemo(() => {
    const agents = [...board.agents.values()];
    return {
      leads: agents.filter((agent) => agentKind(agent, cfg) === "lead").sort(compareAgents),
      brainstorm: agents.filter((agent) => agentKind(agent, cfg) === "brainstorm").sort(compareAgents)[0],
      running: agents.filter((agent) => agent.status === "running").length,
    };
  }, [board.agents, cfg]);
  useSubagentWatch(useMemo(() => (cfg.countSubagents ? leads.map((lead) => lead.id) : []), [leads, cfg]));

  const navigation = navigationOf(props);
  const open = (agent: BoardAgent) => {
    if (navigation) navigation.openAgent({ agentId: agent.id });
    else openScreen({ screenId: OPEN_AGENT_SCREEN, params: { agentId: agent.id } });
  };
  const openParams = (agent: BoardAgent) =>
    currentScreen?.screenId === OPEN_AGENT_SCREEN && currentScreen.params.agentId === agent.id;

  const row = (agent: BoardAgent, label: string) => {
    const attention = attentionLabel(agent);
    const subagents = subagentLabel(board.subagents.get(agent.id));
    const trailing =
      attention || subagents ? (
        <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
          {subagents ? <Chip theme={theme} label={subagents} tone="accent" /> : null}
          {attention ? (
            <Chip theme={theme} label="!" tone={agent.attentionReason === "error" ? "danger" : "warning"} />
          ) : null}
        </View>
      ) : undefined;
    return (
      <SidebarRow
        key={agent.id}
        id={`agent-${agent.id}`}
        icon={dotIcon(statusColor(theme, agent.status))}
        label={label}
        active={openParams(agent)}
        trailing={trailing}
        onPress={() => open(agent)}
      />
    );
  };

  const allLabel =
    board.status === "error"
      ? "Roster (offline)"
      : board.status === "ready"
        ? `Roster (${running} running)`
        : "Roster…";

  return (
    <>
      {leads.map((lead) => row(lead, sidebarTitle(lead, cfg)))}
      {brainstorm ? row(brainstorm, "Brainstorm") : null}
      {leads.length > 0 || brainstorm ? <SidebarSeparator /> : null}
      <SidebarRow
        id="all"
        icon="LayoutList"
        label={allLabel}
        active={currentScreen?.screenId === BOARD_SCREEN}
        onPress={() => openScreen({ screenId: BOARD_SCREEN })}
      />
    </>
  );
}
