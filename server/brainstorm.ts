import type { RpcInput } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { labelArg, runPaseo } from "./paseo-cli";
import { resolveProviderAutoMode, type createBrainstormRpc, type renameBrainstormRpc } from "../shared/brainstorm";
import {
  AGENT_PAGE_LIMIT,
  isBrainstormAgent,
  isLeadAgent,
  isWaitingOnAub,
  clearHandLabels,
  handMatches,
  isDuplicateClick,
  snoozeHandLabels,
  aubMayHaveReplied,
  aubReplied,
  brainstormForLead,
  resolveLead,
  pairLeadsWithBrainstorms,
  NEEDS_AUB_AT_LABEL,
  NEEDS_AUB_LABEL,
  NEEDS_AUB_REASON_LABEL,
  ROSTER_PROMPT_MARKER,
  normalizePath,
  unhandledNeedsAubReason,
  type BoardConfig,
  type ExpectedHand,
} from "../shared/config";

export type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];
type ProviderId = Parameters<PaseoApi["providers"]["listModes"]>[0];
type AgentCreateConfig = Parameters<PaseoApi["agents"]["create"]>[0]["config"];

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function leadAreaFromTitle(title: string | null | undefined, cwd: string, cfg: BoardConfig): string {
  const raw = title?.trim() || "";
  const stripped = (cfg.sidebarStrip ? raw.replace(cfg.sidebarStrip, "") : raw)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bord\d+\b/gi, " ")
    .trim()
    .replace(/^★?\s*LEAD\s*[·:-]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || basename(cwd);
}

export async function renameBrainstorm({ agentId, title, leadKey }: RpcInput<typeof renameBrainstormRpc>) {
  const args = [
    "agent",
    "update",
    agentId,
    "--name",
    title,
    "--label",
    "role=brainstorm",
    ...(leadKey ? ["--label", labelArg("lead", leadKey)] : []),
  ];
  try {
    await runPaseo(args);
    return { ok: true, message: `Renamed to ${title}` };
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

/** Brainstorm creation per project root runs one at a time, so a second click sees the first one's agent. */
const createLocks = new Map<string, Promise<unknown>>();
/** Project root -> the brainstorm just created there; the listing can lag behind agents.create, and the title is set later. */
const recentCreates = new Map<string, { agentId: string; slug: string; title: string; at: number }>();
export const RECENT_BRAINSTORM_MS = 10 * 60_000;
const UNLISTED_GRACE_MS = 2 * 60_000;

type CreateResult = { ok: boolean; reused: boolean; message: string; agentId?: string };

const projectKey = (cwd: string, root?: string) => normalizePath(root?.trim() || cwd);

export async function createBrainstorm(
  input: RpcInput<typeof createBrainstormRpc>,
  paseo: PaseoApi,
  cfg: BoardConfig,
): Promise<CreateResult> {
  const key = projectKey(input.cwd, input.projectRootPath);
  const previous = createLocks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => createBrainstormLocked(input, paseo, cfg));
  createLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (createLocks.get(key) === run) createLocks.delete(key);
  }
}

async function createBrainstormLocked(
  {
    leadId,
    leadTitle,
    area,
    cwd,
    profile,
    modeId: modeInput,
    workspaceId,
    workspaceName,
    projectDisplayName,
    projectRootPath,
    reuseExisting,
    reason,
  }: RpcInput<typeof createBrainstormRpc>,
  paseo: PaseoApi,
  cfg: BoardConfig,
): Promise<CreateResult> {
  const cwdNorm = normalizePath(cwd);
  const rootNorm = projectRootPath ? normalizePath(projectRootPath) : "";
  let matchedLead:
    | { id: string; title: string | null; cwd: string; labels?: Record<string, string> }
    | undefined;

  let resolvedLeadId = leadId?.trim();
  let resolvedLeadTitle = leadTitle?.trim();

  const listed = await paseo.agents
    .list({
      includeBackground: true,
      filter: { includeBackground: true },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: AGENT_PAGE_LIMIT },
    })
    .catch(() => null);
  if (!listed) return { ok: false, reused: false, message: "Could not list agents, so no brainstorm was created. Try again." };
  const allAgents = listed.entries.map((e) => e.agent);
  const liveAgents = allAgents.filter((a) => !a.archivedAt && a.status !== "closed");

  // The caller's leadId may be stale (an old successor, a closed or retired lead): name the project's current lead.
  matchedLead = resolveLead(leadId?.trim(), allAgents, { cwd, rootPath: projectRootPath, area: area?.trim() }, {
    isLead: (a) => isLeadAgent(a.title, a.labels ?? {}, cfg),
    areaOf: (a) => leadAreaFromTitle(a.title, a.cwd, cfg),
  });
  if (matchedLead && matchedLead.id !== leadId?.trim()) {
    if (leadId) console.log(`brainstorm: lead ${leadId.slice(0, 8)} is stale, using ${matchedLead.id.slice(0, 8)}`);
    resolvedLeadId = matchedLead.id;
    resolvedLeadTitle = matchedLead.title?.trim() || `Agent ${matchedLead.id.slice(0, 7)}`;
  } else if (matchedLead) {
    resolvedLeadTitle = leadTitle?.trim() || matchedLead.title?.trim() || `Agent ${matchedLead.id.slice(0, 7)}`;
  }

  const reuse = async (existing: { id: string; title: string | null }): Promise<CreateResult> => {
    if (reason?.trim()) {
      const leadDesc = resolvedLeadTitle ? `"${resolvedLeadTitle}" (${resolvedLeadId})` : resolvedLeadId ?? cwd;
      await paseo.agents
        .ref(existing.id)
        .send(`Lead ${leadDesc} needs a decision on: ${reason.trim()}

Please review and surface this for Aub.

${ROSTER_PROMPT_MARKER}`)
        .catch(() => undefined);
    }
    return { ok: true, reused: true, message: `Opened ${existing.title ?? "brainstorm"}`, agentId: existing.id };
  };

  if (reuseExisting) {
    const liveBrainstorms = liveAgents.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg));
    const target = {
      labels: matchedLead?.labels,
      workspaceId: workspaceId ?? (matchedLead as { workspaceId?: string } | undefined)?.workspaceId,
      cwd,
    };
    // Pair against every live lead, so an unlabeled target can't take another lead's keyed brainstorm.
    const otherLeads = liveAgents.filter(
      (a) => a.id !== matchedLead?.id && isLeadAgent(a.title, a.labels ?? {}, cfg),
    );
    const targetId = matchedLead?.id ?? "__target__";
    const pair = (t: typeof target) =>
      brainstormForLead({ id: targetId, ...t }, [...otherLeads, { id: targetId, ...t }], liveBrainstorms, cfg);
    const existing =
      pair(target) ?? (rootNorm !== "" ? pair({ ...target, workspaceId: undefined, cwd: rootNorm }) : undefined);
    if (existing) return reuse(existing);
  }

  const resolvedArea =
    area?.trim() ||
    (matchedLead ? leadAreaFromTitle(matchedLead.title, matchedLead.cwd, cfg) : "") ||
    projectDisplayName?.trim() ||
    workspaceName?.trim() ||
    basename(cwd);

  const title = `BRAINSTORM · ${resolvedArea}`;
  const slug =
    matchedLead?.labels?.[cfg.labels.lead] ||
    resolvedArea
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    "project";

  const configRes = await paseo.config.get().catch(() => null);
  const daemonConfig = configRes?.config as
    | (NonNullable<typeof configRes>["config"] & {
        daemon?: { agentProfiles?: NonNullable<typeof configRes>["config"]["agentProfiles"] };
      })
    | undefined;
  const profiles = daemonConfig?.agentProfiles ?? daemonConfig?.daemon?.agentProfiles ?? [];
  const wantedProfile = profile?.trim() || cfg.brainstormProfile;
  const matched =
    (wantedProfile ? profiles.find((p) => p.id === wantedProfile || p.name === wantedProfile) : undefined) ??
    profiles.find((p) => /brainstorm/i.test(p.name));

  const providerId: ProviderId = matched ? matched.provider : "claude";
  const providerSpec = matched
    ? matched.model
      ? `${matched.provider}/${matched.model}`
      : matched.provider
    : "claude/claude-opus-5-5";

  const modesResult = await paseo.providers.listModes(providerId, { cwd }).catch(() => undefined);
  const availableModeIds = (modesResult?.modes ?? []).map((mode) => mode.id);
  const requestedMode = modeInput?.trim() || cfg.brainstormModeId || "auto";
  let modeId: string;
  if (requestedMode === "auto") modeId = resolveProviderAutoMode(providerId, availableModeIds);
  else if (requestedMode === "profile") modeId = matched?.modeId || resolveProviderAutoMode(providerId, availableModeIds);
  else if (availableModeIds.length === 0 || availableModeIds.includes(requestedMode)) modeId = requestedMode;
  else modeId = resolveProviderAutoMode(providerId, availableModeIds);

  const baseConfig: AgentCreateConfig = {
    provider: providerSpec,
    modeId,
    thinkingOptionId: matched?.thinkingOptionId ?? "medium",
    ...(matched?.featureValues ? { featureValues: matched.featureValues } : {}),
  };
  const config: AgentCreateConfig =
    providerId === "antigravity-cli"
      ? Object.assign(baseConfig, { settings: { shareMcp: "on" } })
      : baseConfig;

  const basePrompt = reason?.trim()
    ? `Lead "${resolvedLeadTitle ?? resolvedArea}" (${resolvedLeadId ?? cwd}) needs a decision on: ${reason.trim()}. You are the Brainstorm chat for ${resolvedArea} (${cwd}). Summarize the decision needed for Aub and riff with Aub here, then message the lead when approved.`
    : resolvedLeadId
      ? `You are the Brainstorm chat for ${resolvedArea} (${cwd}). Current active lead: "${resolvedLeadTitle}" (${resolvedLeadId}). Riff with Aub here and dispatch or message the lead when approved.`
      : `You are the Brainstorm chat for ${resolvedArea} (${cwd}). Riff with Aub here and dispatch or start a lead when approved.`;
  // The boot prompt lands as a user message that can post-date needs-aub-at; the marker keeps it from reading as Aub.
  const prompt = `${basePrompt}\n\n${ROSTER_PROMPT_MARKER}`;

  // A brainstorm made moments ago may not be listed or titled yet; the same project reuses it.
  const now = Date.now();
  const recentKey = projectKey(cwd, projectRootPath);
  const recentKeys = [cwdNorm, rootNorm].filter(Boolean);
  for (const [k, r] of recentCreates) if (now - r.at > RECENT_BRAINSTORM_MS) recentCreates.delete(k);
  const recentHit = recentCreates.get(recentKey)?.slug === slug ? recentCreates.get(recentKey) : undefined;
  if (recentHit) {
    const listedHit = allAgents.find((a) => a.id === recentHit.agentId);
    const alive = listedHit ? !listedHit.archivedAt && listedHit.status !== "closed" : now - recentHit.at < UNLISTED_GRACE_MS;
    if (alive) return reuse({ id: recentHit.agentId, title: listedHit?.title ?? recentHit.title });
  }
  // A live brainstorm already keyed to this project, even one the lead pairing skipped.
  const keyed = liveAgents.find(
    (a) =>
      isBrainstormAgent(a.title, a.labels ?? {}, cfg) &&
      a.labels?.[cfg.labels.lead]?.trim().toLowerCase() === slug &&
      recentKeys.includes(normalizePath(a.cwd)),
  );
  if (keyed) return reuse(keyed);

  const handle = await paseo.agents.create({
    cwd,
    title,
    labels: { role: "brainstorm", lead: slug },
    config,
    prompt,
  });
  recentCreates.set(recentKey, { agentId: handle.id, slug, title, at: Date.now() });
  return {
    ok: true,
    reused: false,
    message: `Created ${title} (${matched?.name ?? providerSpec}, ${modeId})`,
    agentId: handle.id,
  };
}

export async function updateAgentLabels(agentId: string, labels: Readonly<Record<string, string>>): Promise<boolean> {
  const args = ["agent", "update", agentId, ...Object.entries(labels).flatMap(([k, v]) => ["--label", labelArg(k, v)])];
  try {
    await runPaseo(args);
    return true;
  } catch (error) {
    console.error(`label update for ${agentId} failed: ${messageOf(error)}`);
    return false;
  }
}

/** Lead id -> when Aub's last clear/snooze was accepted; stamped synchronously before the label write's await. */
const recentHandActionAt = new Map<string, number>();

export async function aubHandAction(
  kind: "clear" | "snooze",
  leadId: string,
  expected: ExpectedHand,
  paseo: PaseoApi,
): Promise<{ ok: boolean; message: string }> {
  const now = Date.now();
  for (const [id, at] of recentHandActionAt) if (!isDuplicateClick(at, now)) recentHandActionAt.delete(id);
  if (isDuplicateClick(recentHandActionAt.get(leadId), now)) return { ok: true, message: "Already done" };
  if (kind === "snooze" && !expected.flagAt) return { ok: false, message: "Still being routed, try again in a moment" };
  recentHandActionAt.set(leadId, now);
  // Compare before write: the flag may have been re-raised or cleared since the UI showed it.
  const current = await freshLeadLabels(paseo, leadId);
  if (!current || !handMatches(current, expected)) {
    recentHandActionAt.delete(leadId);
    return { ok: false, message: "hand changed, not cleared" };
  }
  const ok = await updateAgentLabels(
    leadId,
    kind === "clear" ? clearHandLabels(now) : snoozeHandLabels(expected.flagAt, now),
  );
  if (!ok) {
    recentHandActionAt.delete(leadId);
    return { ok: false, message: `Could not ${kind} the hand` };
  }
  console.log(`${kind === "clear" ? "cleared" : "snoozed 1h"} raised hand of ${leadId.slice(0, 8)} (by aub)`);
  return { ok: true, message: kind === "clear" ? "Cleared" : "Snoozed 1h" };
}

/** The lead's labels right now (not a snapshot taken earlier in a pass); null when the lookup fails. */
async function freshLeadLabels(paseo: PaseoApi, leadId: string): Promise<Record<string, string> | null> {
  const listed = await paseo.agents
    .list({ includeBackground: true, filter: { includeBackground: true }, page: { limit: AGENT_PAGE_LIMIT } })
    .catch(() => null);
  const agent = listed?.entries.find((e) => e.agent.id === leadId)?.agent;
  return agent ? (agent.labels ?? {}) : null;
}

async function routedBaselineMs(paseo: PaseoApi, brainstormId: string | undefined): Promise<number> {
  let baseline = Date.now();
  if (!brainstormId) return baseline;
  const listed = await paseo.agents
    .list({ includeBackground: true, filter: { includeBackground: true }, page: { limit: AGENT_PAGE_LIMIT } })
    .catch(() => null);
  const userMs = Date.parse(listed?.entries.find((e) => e.agent.id === brainstormId)?.agent.lastUserMessageAt ?? "");
  if (Number.isFinite(userMs)) baseline = Math.max(baseline, userMs);
  return baseline;
}

export class NeedsAubWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private boundPaseo: PaseoApi | null = null;
  private readonly inFlight = new Set<string>();
  /**
   * Lead id -> a flag already routed whose "handled" label write hasn't landed yet. Later ticks retry only the
   * write, never createBrainstorm. Dropped on success, or when the lead is gone or no longer flagged.
   */
  private readonly routed = new Map<string, { reason: string; labels: Record<string, string> }>();

  private readonly getConfig: () => BoardConfig;

  constructor(getConfig: () => BoardConfig) {
    this.getConfig = getConfig;
  }

  bind(paseo: PaseoApi): void {
    this.boundPaseo = paseo;
  }

  start(): () => void {
    this.timer = setInterval(() => {
      if (this.boundPaseo) {
        void this.checkNow(this.boundPaseo).catch((error) =>
          console.error(`needs-aub check failed: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    }, 15_000);
    return () => {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  async checkNow(paseo?: PaseoApi): Promise<void> {
    const p = paseo ?? this.boundPaseo;
    if (!p) return;
    const cfg = this.getConfig();

    const listed = await p.agents
      .list({
        includeBackground: true,
        filter: { includeBackground: true },
        page: { limit: AGENT_PAGE_LIMIT },
      })
      .catch(() => null);
    // A failed list would look like "no leads" and prune pending label retries from `routed`.
    if (!listed) return;
    const live = listed.entries
      .map((e) => e.agent)
      .filter((a) => !a.archivedAt && a.status !== "closed");
    const leads = live.filter((a) => isLeadAgent(a.title, a.labels ?? {}, cfg));
    const brainstorms = live.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg));

    const { pairs } = pairLeadsWithBrainstorms(leads, brainstorms, cfg);
    for (const id of [...this.routed.keys()]) {
      const lead = leads.find((l) => l.id === id);
      if (!lead || !unhandledNeedsAubReason(lead.labels)) this.routed.delete(id);
    }
    for (const lead of leads) {
      const reason = unhandledNeedsAubReason(lead.labels);
      // Spawns only for a real, non-empty, unhandled reason.
      if (reason) {
        if (!cfg.needsAubAutoSpawn || this.inFlight.has(lead.id)) continue;
        this.inFlight.add(lead.id);
        try {
          // Compare before write: Aub may have cleared or changed the flag since the snapshot above.
          const stillFlagged = async () => unhandledNeedsAubReason((await freshLeadLabels(p, lead.id)) ?? undefined) === reason;
          if (!(await stillFlagged())) {
            this.routed.delete(lead.id);
            continue;
          }
          let pending = this.routed.get(lead.id);
          if (pending?.reason !== reason) {
            this.routed.delete(lead.id);
            const routed = await createBrainstorm(
              {
                leadId: lead.id,
                leadTitle: lead.title ?? undefined,
                area: leadAreaFromTitle(lead.title, lead.cwd, cfg),
                cwd: lead.cwd,
                workspaceId: lead.workspaceId ?? undefined,
                reuseExisting: true,
                reason,
              },
              p,
              cfg,
            );
            // Routing sends a prompt into the brainstorm, which bumps its lastUserMessageAt. Stamp after
            // that, and no earlier than the brainstorm's own latest user message, so only a later message clears.
            const flaggedAt = new Date(await routedBaselineMs(p, routed.agentId)).toISOString();
            pending = {
              reason,
              labels: {
                [NEEDS_AUB_LABEL]: "handled",
                [NEEDS_AUB_REASON_LABEL]: reason,
                [NEEDS_AUB_AT_LABEL]: flaggedAt,
              },
            };
            this.routed.set(lead.id, pending);
          }
          if (!(await stillFlagged())) {
            this.routed.delete(lead.id);
            continue;
          }
          if (await updateAgentLabels(lead.id, pending.labels)) this.routed.delete(lead.id);
        } catch (error) {
          console.error(
            `auto-spawn brainstorm for ${lead.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          this.inFlight.delete(lead.id);
        }
      } else if (lead.labels?.[NEEDS_AUB_LABEL]?.toLowerCase() === "handled") {
        const brainstorm = pairs.get(lead.id);
        if (brainstorm && aubMayHaveReplied(lead.labels, brainstorm.lastUserMessageAt)) {
          // lastUserMessageAt also counts agent-sent prompts; confirm a human-typed message in the timeline.
          const tail = await p.agents
            .ref(brainstorm.id)
            .timeline.refetch({ direction: "tail", limit: 40 })
            .then((page) => page.entries)
            .catch(() => undefined);
          if (aubReplied(lead.labels, brainstorm.lastUserMessageAt, tail)) {
            // Only now are the stamp and reason blanked, so a later re-flag starts clean.
            await updateAgentLabels(lead.id, {
              [NEEDS_AUB_LABEL]: "cleared",
              [NEEDS_AUB_AT_LABEL]: "",
              [NEEDS_AUB_REASON_LABEL]: "",
            });
          }
        }
      }
    }
  }
}
