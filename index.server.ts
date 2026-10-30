import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Handoffs } from "./server/handoff";
import { stopAgent } from "./server/stop";
import { fixChainedLeadsRpc, handoffStateRpc, promoteLeadRpc } from "./shared/handoff";
import { rosterSettings } from "./shared/settings";
import { stopAgentRpc } from "./shared/stop";

export default function contribute(server: PluginServerContext) {
  const handoffs = new Handoffs(server.registerSettings(rosterSettings));
  const stopSettings = handoffs.start();

  server.handle(stopAgentRpc, stopAgent);
  server.handle(handoffStateRpc, () => handoffs.snapshot());
  server.handle(promoteLeadRpc, ({ agentId }, { paseo }) => handoffs.promote(agentId, paseo));
  server.handle(fixChainedLeadsRpc, (_input, { paseo }) => handoffs.fixChains(paseo));

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
