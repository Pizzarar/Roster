import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Handoffs } from "./server/handoff";
import { stopAgent } from "./server/stop";
import { fixChainedLeadsRpc, handoffStateRpc, promoteLeadRpc } from "./shared/handoff";
import { rosterSettings } from "./shared/settings";
import { stopAgentRpc } from "./shared/stop";

const LEAD_POINTER =
  "To find a project's current lead: run `paseo ls -g --json` and pick the agent whose cwd matches the project and whose name starts with ★ LEAD (never one starting with (old)).";

const LABEL_INSTRUCTION =
  "Roster labels: once you know your role, label yourself with Paseo's update_agent tool. A lead sets role=lead and lead=<project>; a brainstorm chat sets role=brainstorm; a worker sets role=worker, its lead's lead=<project> and task=<short task name>. Pass lead=<project> on to agents you spawn.";

function appendLine(systemPrompt: string, line: string): string {
  if (systemPrompt.includes(line)) return systemPrompt;
  return systemPrompt.trim() ? `${systemPrompt.trim()}\n\n${line}` : line;
}

export default function contribute(server: PluginServerContext) {
  const handoffs = new Handoffs(server.registerSettings(rosterSettings));
  const stopSettings = handoffs.start();

  server.handle(stopAgentRpc, stopAgent);
  server.handle(handoffStateRpc, () => handoffs.snapshot());
  server.handle(promoteLeadRpc, ({ agentId }, { paseo }) => handoffs.promote(agentId, paseo));
  server.handle(fixChainedLeadsRpc, (_input, { paseo }) => handoffs.fixChains(paseo));

  // Tell every new agent how to find a project's current lead, and optionally how to label itself.
  server.before("agent.create", ({ request }) => {
    const original = request.config.systemPrompt ?? "";
    let systemPrompt = appendLine(original, LEAD_POINTER);
    if (handoffs.config.labelInstruction) systemPrompt = appendLine(systemPrompt, LABEL_INSTRUCTION);
    if (systemPrompt === original) return;
    return { ...request, config: { ...request.config, systemPrompt } };
  });

  server.on("agent.created", ({ agent }, { paseo }) => handoffs.onCreated(agent, paseo));
  server.on("agent.turn_started", ({ agent }, { paseo }) => handoffs.onTurnStarted(agent, paseo));
  server.on("agent.archived", ({ agent }) => handoffs.onArchived(agent));
  server.on("agent.turn_ended", ({ agent, outcome }, { paseo }) =>
    handoffs.relayTurnEnded(agent, outcome, paseo).catch((error) => console.error(`relay failed: ${error}`)),
  );
  server.on("agent.permission_requested", ({ agent, request }, { paseo }) =>
    handoffs
      .relayPermission(agent, request.title ?? request.name, paseo)
      .catch((error) => console.error(`relay failed: ${error}`)),
  );

  return async () => {
    (await stopSettings.catch(() => undefined))?.();
  };
}
