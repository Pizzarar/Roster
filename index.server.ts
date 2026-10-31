import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AutoArchiver } from "./server/auto-archive";
import { checkInLeads, createBrainstorm, NeedsAubWatcher, renameBrainstorm } from "./server/brainstorm";
import { Handoffs } from "./server/handoff";
import { stopAgent } from "./server/stop";
import { checkWorkspaceMerges } from "./server/workspaces";
import { checkWorkspaceMergesRpc } from "./shared/workspaces";
import { autoArchiveStateRpc, runAutoArchiveRpc, undoAutoArchiveRpc } from "./shared/auto-archive";
import { checkInLeadsRpc, createBrainstormRpc, renameBrainstormRpc } from "./shared/brainstorm";
import { fixChainedLeadsRpc, handoffStateRpc, promoteLeadRpc } from "./shared/handoff";
import { rosterSettings } from "./shared/settings";
import { stopAgentRpc } from "./shared/stop";

function appendLine(systemPrompt: string, line: string): string {
  if (systemPrompt.includes(line)) return systemPrompt;
  return systemPrompt.trim() ? `${systemPrompt.trim()}\n\n${line}` : line;
}

export default function contribute(server: PluginServerContext) {
  const handoffs = new Handoffs(server.registerSettings(rosterSettings));
  const stopSettings = handoffs.start();
  const autoArchiver = new AutoArchiver(() => handoffs.config);
  const stopAutoArchive = autoArchiver.start();
  const needsAubWatcher = new NeedsAubWatcher(() => handoffs.config);
  const stopNeedsAub = needsAubWatcher.start();

  server.handle(stopAgentRpc, stopAgent);
  server.handle(checkInLeadsRpc, (_input, { paseo }) => checkInLeads(paseo, handoffs.config));
  server.handle(autoArchiveStateRpc, (_input, { paseo }) => {
    autoArchiver.bind(paseo);
    return autoArchiver.snapshot();
  });
  server.handle(runAutoArchiveRpc, ({ dryRun }, { paseo }) => autoArchiver.runPass({ dryRun, paseo }));
  server.handle(undoAutoArchiveRpc, (input, { paseo }) => autoArchiver.undo({ ...input, paseo }));
  server.handle(checkWorkspaceMergesRpc, checkWorkspaceMerges);
  server.handle(renameBrainstormRpc, renameBrainstorm);
  server.handle(createBrainstormRpc, (input, { paseo }) => createBrainstorm(input, paseo, handoffs.config));
  server.handle(handoffStateRpc, (_input, { paseo }) => {
    autoArchiver.bind(paseo);
    return handoffs.snapshot();
  });
  server.handle(promoteLeadRpc, ({ agentId }, { paseo }) => handoffs.promote(agentId, paseo));
  server.handle(fixChainedLeadsRpc, (_input, { paseo }) => handoffs.fixChains(paseo));

  // Tell every new agent how to find a project's current lead, and optionally how to label itself.
  server.before("agent.create", ({ request }) => {
    const original = request.config.systemPrompt ?? "";
    let systemPrompt = original;
    if (handoffs.config.leadPointerPrompt) {
      systemPrompt = appendLine(systemPrompt, handoffs.config.leadPointerPrompt);
    }
    if (handoffs.config.brainstormPrompt) {
      systemPrompt = appendLine(systemPrompt, handoffs.config.brainstormPrompt);
    }
    if (handoffs.config.leadPrompt) {
      systemPrompt = appendLine(systemPrompt, handoffs.config.leadPrompt);
    }
    if (handoffs.config.needsAubPrompt) {
      systemPrompt = appendLine(systemPrompt, handoffs.config.needsAubPrompt);
    }
    if (handoffs.config.imagePrompt) {
      systemPrompt = appendLine(systemPrompt, handoffs.config.imagePrompt);
    }
    if (systemPrompt === original) return;
    return { ...request, config: { ...request.config, systemPrompt } };
  });

  server.on("agent.created", ({ agent }, { paseo }) => {
    autoArchiver.bind(paseo);
    needsAubWatcher.bind(paseo);
    void needsAubWatcher.checkNow(paseo);
    return handoffs.onCreated(agent, paseo);
  });
  server.on("agent.turn_started", ({ agent }, { paseo }) => {
    autoArchiver.bind(paseo);
    needsAubWatcher.bind(paseo);
    void needsAubWatcher.onTurnStarted(agent.id, paseo);
    return handoffs.onTurnStarted(agent, paseo);
  });
  server.on("agent.archived", ({ agent }) => handoffs.onArchived(agent));
  server.on("agent.turn_ended", ({ agent, outcome }, { paseo }) => {
    needsAubWatcher.bind(paseo);
    void needsAubWatcher.checkNow(paseo);
    return handoffs.relayTurnEnded(agent, outcome, paseo).catch((error) => console.error(`relay failed: ${error}`));
  });
  server.on("agent.permission_requested", ({ agent, request }, { paseo }) => {
    needsAubWatcher.bind(paseo);
    void needsAubWatcher.checkNow(paseo);
    return handoffs
      .relayPermission(agent, request.title ?? request.name, paseo)
      .catch((error) => console.error(`relay failed: ${error}`));
  });

  return async () => {
    stopNeedsAub();
    stopAutoArchive();
    (await stopSettings.catch(() => undefined))?.();
  };
}
