import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Handoffs } from "./server/handoff";
import { stopAgent } from "./server/stop";
import { fixChainedLeadsRpc, handoffStateRpc, promoteLeadRpc } from "./shared/handoff";
import { rosterSettings } from "./shared/settings";
import { stopAgentRpc } from "./shared/stop";

const LEAD_POINTER =
  "To find a project's current lead: run `paseo ls -g --json` and pick the agent whose cwd matches the project and whose name starts with ★ LEAD (never one starting with (old)).";

export default function contribute(server: PluginServerContext) {
  const handoffs = new Handoffs(server.registerSettings(rosterSettings));
  const stopSettings = handoffs.start();

  server.handle(stopAgentRpc, stopAgent);
  server.handle(handoffStateRpc, () => handoffs.snapshot());
  server.handle(promoteLeadRpc, ({ agentId }, { paseo }) => handoffs.promote(agentId, paseo));
  server.handle(fixChainedLeadsRpc, (_input, { paseo }) => handoffs.fixChains(paseo));

  // Tell every new agent how to find a project's current lead.
  server.before("agent.create", ({ request }) => {
    const systemPrompt = request.config.systemPrompt ?? "";
    if (systemPrompt.includes(LEAD_POINTER)) return;
    const merged = systemPrompt.trim() ? `${systemPrompt.trim()}\n\n${LEAD_POINTER}` : LEAD_POINTER;
    return { ...request, config: { ...request.config, systemPrompt: merged } };
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
