import { sortProfilesInConfig } from "./server/profile-sort";
import { sortProfilesRpc } from "./shared/profile-sort";
import { backupConfig } from "./server/profiles-backup";
import { backupConfigRpc } from "./shared/profiles-backup";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { AutoArchiver } from "./server/auto-archive";
import { CheckIns } from "./server/check-in";
import { aubHandAction, createBrainstorm, NeedsAubWatcher, renameBrainstorm } from "./server/brainstorm";
import { Handoffs } from "./server/handoff";
import { stopAgent } from "./server/stop";
import { checkWorkspaceMerges } from "./server/workspaces";
import { checkWorkspaceMergesRpc } from "./shared/workspaces";
import { autoArchiveStateRpc, runAutoArchiveRpc, undoAutoArchiveRpc } from "./shared/auto-archive";
import { checkInLeadsRpc, clearHandRpc, createBrainstormRpc, renameBrainstormRpc, snoozeHandRpc } from "./shared/brainstorm";
import { fixChainedLeadsRpc, handoffStateRpc, promoteLeadRpc } from "./shared/handoff";
import { compileConfig } from "./shared/config";
import type { RosterSettings } from "./shared/settings";
import { rosterSettings } from "./shared/settings";
import { stopAgentRpc } from "./shared/stop";

function appendLine(systemPrompt: string, line: string): string {
  if (systemPrompt.includes(line)) return systemPrompt;
  return systemPrompt.trim() ? `${systemPrompt.trim()}\n\n${line}` : line;
}

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(rosterSettings);
  const handoffs = new Handoffs(settings);
  const stopSettings = handoffs.start();
  // Re-sort Paseo's profile list when the group order or the keep-sorted switch changes (needs a bound daemon API).
  let lastPaseo: Parameters<typeof sortProfilesInConfig>[0] | null = null;
  let sortKey: string | null = null;
  const sortKeyOf = (state: { status: string; values?: unknown }) => {
    if (state.status !== "ready") return null;
    const cfg = compileConfig(state.values as RosterSettings);
    return { cfg, key: cfg.keepProfilesSorted ? cfg.groupOrder.join("\u001f") : "off" };
  };
  void settings.read().then((state) => {
    sortKey ??= sortKeyOf(state)?.key ?? null;
  });
  const stopSortWatch = settings.subscribe((state) => {
    const next = sortKeyOf(state);
    if (!next) return;
    const { cfg, key } = next;
    const changed = sortKey !== null && key !== sortKey;
    sortKey = key;
    if (changed && cfg.keepProfilesSorted && lastPaseo) {
      void sortProfilesInConfig(lastPaseo, cfg.groupOrder).catch((error) => console.error(`profile sort failed: ${error}`));
    }
  });
  const autoArchiver = new AutoArchiver(() => handoffs.config);
  const stopAutoArchive = autoArchiver.start();
  const checkIns = new CheckIns(() => handoffs.config);
  const needsAubWatcher = new NeedsAubWatcher(() => handoffs.config);
  const stopNeedsAub = needsAubWatcher.start();

  server.handle(stopAgentRpc, stopAgent);
  server.handle(backupConfigRpc, backupConfig);
  server.handle(sortProfilesRpc, ({ dryRun }, { paseo }) => {
    lastPaseo = paseo;
    return sortProfilesInConfig(paseo, handoffs.config.groupOrder, dryRun);
  });
  server.handle(checkInLeadsRpc, ({ leadId }, { paseo }) => checkIns.run(paseo, leadId));
  server.handle(clearHandRpc, ({ leadId, flagAt, reason }, { paseo }) =>
    aubHandAction("clear", leadId, { flagAt, reason }, paseo),
  );
  server.handle(snoozeHandRpc, ({ leadId, flagAt, reason }, { paseo }) =>
    aubHandAction("snooze", leadId, { flagAt, reason }, paseo),
  );
  server.handle(autoArchiveStateRpc, (_input, { paseo }) => {
    lastPaseo = paseo;
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
    for (const rule of handoffs.config.guidanceRules) {
      const title = rule.title.trim();
      const text = rule.text.trim();
      const formatted = title && text ? `## ${title}\n${text}` : title ? `## ${title}` : text;
      if (formatted) {
        systemPrompt = appendLine(systemPrompt, formatted);
      }
    }
    if (handoffs.config.imagePrompt) {
      systemPrompt = appendLine(systemPrompt, handoffs.config.imagePrompt);
    }
    if (systemPrompt === original) return;
    return { ...request, config: { ...request.config, systemPrompt } };
  });

  server.on("agent.created", ({ agent }, { paseo }) => {
    lastPaseo = paseo;
    autoArchiver.bind(paseo);
    needsAubWatcher.bind(paseo);
    void needsAubWatcher.checkNow(paseo);
    return handoffs.onCreated(agent, paseo);
  });
  server.on("agent.turn_started", ({ agent }, { paseo }) => {
    lastPaseo = paseo;
    autoArchiver.bind(paseo);
    needsAubWatcher.bind(paseo);
    return handoffs.onTurnStarted(agent, paseo);
  });
  server.on("agent.archived", ({ agent }) => {
    checkIns.onArchived(agent);
    return handoffs.onArchived(agent);
  });
  server.on("agent.turn_ended", ({ agent, outcome }, { paseo }) => {
    void checkIns.onTurnEnded(agent, outcome, paseo);
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
    stopSortWatch();
    stopNeedsAub();
    stopAutoArchive();
    (await stopSettings.catch(() => undefined))?.();
  };
}
