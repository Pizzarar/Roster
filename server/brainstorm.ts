import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { checkInLeadsRpc, resolveProviderAutoMode, type createBrainstormRpc, type renameBrainstormRpc } from "../shared/brainstorm";
import {
  AGENT_PAGE_LIMIT,
  isBrainstormAgent,
  isLeadAgent,
  isWaitingOnAub,
  aubMayHaveReplied,
  aubReplied,
  matchBrainstormForLead,
  NEEDS_AUB_AT_LABEL,
  NEEDS_AUB_LABEL,
  NEEDS_AUB_REASON_LABEL,
  normalizePath,
  unhandledNeedsAubReason,
  type BoardConfig,
} from "../shared/config";

type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];
type ProviderId = Parameters<PaseoApi["providers"]["listModes"]>[0];
type AgentCreateConfig = Parameters<PaseoApi["agents"]["create"]>[0]["config"];

function paseoCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.PASEO_CLI) {
    candidates.push(process.env.PASEO_CLI);
  }
  candidates.push("paseo");
  if (process.env.APPDATA) {
    candidates.push(`${process.env.APPDATA}\\npm\\paseo.cmd`);
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push(`${process.env.LOCALAPPDATA}\\Programs\\Paseo\\resources\\bin\\paseo.cmd`);
  }
  return candidates;
}

function messageOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}

function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function leadAreaFromTitle(title: string | null | undefined, cwd: string, cfg: BoardConfig): string {
  const raw = title?.trim() || "";
  const stripped = (cfg.sidebarStrip ? raw.replace(cfg.sidebarStrip, "") : raw)
    .replace(/^★?\s*LEAD\s*[·:-]?\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+\bord\d+\b.*$/i, "")
    .trim();
  return stripped || basename(cwd);
}

export async function renameBrainstorm({ agentId, title, leadKey }: RpcInput<typeof renameBrainstormRpc>) {
  let lastError = "paseo CLI not found";
  const args = [
    "agent",
    "update",
    agentId,
    "--name",
    title,
    "--label",
    "role=brainstorm",
    ...(leadKey ? ["--label", `lead=${leadKey}`] : []),
  ];

  for (const command of paseoCandidates()) {
    try {
      await execCommand(command, args, { timeout: 30_000 });
      return { ok: true, message: `Renamed to ${title}` };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      lastError = messageOf(error);
      if (code !== "ENOENT") break;
    }
  }

  return { ok: false, message: lastError };
}

export async function createBrainstorm(
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
) {
  const cwdNorm = normalizePath(cwd);
  const rootNorm = projectRootPath ? normalizePath(projectRootPath) : "";
  let matchedLead:
    | { id: string; title: string | null; cwd: string; labels?: Record<string, string> }
    | undefined;

  let resolvedLeadId = leadId?.trim();
  let resolvedLeadTitle = leadTitle?.trim();

  if (reuseExisting || !leadId || !area) {
    const listed = await paseo.agents
      .list({
        includeBackground: true,
        filter: { includeBackground: true },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: AGENT_PAGE_LIMIT },
      })
      .catch(() => null);
    const liveAgents = (listed?.entries ?? [])
      .map((e) => e.agent)
      .filter((a) => !a.archivedAt && a.status !== "closed");

    matchedLead = leadId
      ? liveAgents.find((a) => a.id === leadId)
      : liveAgents.find(
          (a) =>
            isLeadAgent(a.title, a.labels ?? {}, cfg) &&
            (normalizePath(a.cwd) === cwdNorm || (rootNorm !== "" && normalizePath(a.cwd) === rootNorm)),
        );

    resolvedLeadId = leadId?.trim() || matchedLead?.id;
    resolvedLeadTitle =
      leadTitle?.trim() ||
      matchedLead?.title?.trim() ||
      (matchedLead ? `Agent ${matchedLead.id.slice(0, 7)}` : undefined);

    if (reuseExisting) {
      const liveBrainstorms = liveAgents.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg));
      const target = {
        labels: matchedLead?.labels,
        workspaceId: workspaceId ?? (matchedLead as { workspaceId?: string } | undefined)?.workspaceId,
        cwd,
      };
      const existing =
        matchBrainstormForLead(target, liveBrainstorms, cfg) ??
        (rootNorm !== ""
          ? matchBrainstormForLead({ ...target, workspaceId: undefined, cwd: rootNorm }, liveBrainstorms, cfg)
          : undefined);
      if (existing) {
        if (reason?.trim()) {
          const leadDesc = resolvedLeadTitle ? `"${resolvedLeadTitle}" (${resolvedLeadId})` : resolvedLeadId ?? cwd;
          await paseo.agents
            .ref(existing.id)
            .send(`Lead ${leadDesc} needs a decision on: ${reason.trim()}\n\nPlease review and surface this for Aub.`)
            .catch(() => undefined);
        }
        return {
          ok: true,
          reused: true,
          message: `Opened ${existing.title ?? "brainstorm"}`,
          agentId: existing.id,
        };
      }
    }
  }

  resolvedLeadId = resolvedLeadId || leadId?.trim() || matchedLead?.id;
  resolvedLeadTitle =
    resolvedLeadTitle ||
    leadTitle?.trim() ||
    matchedLead?.title?.trim() ||
    (matchedLead ? `Agent ${matchedLead.id.slice(0, 7)}` : undefined);
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

  const prompt = reason?.trim()
    ? `Lead "${resolvedLeadTitle ?? resolvedArea}" (${resolvedLeadId ?? cwd}) needs a decision on: ${reason.trim()}. You are the Brainstorm chat for ${resolvedArea} (${cwd}). Summarize the decision needed for Aub and riff with Aub here, then message the lead when approved.`
    : resolvedLeadId
      ? `You are the Brainstorm chat for ${resolvedArea} (${cwd}). Current active lead: "${resolvedLeadTitle}" (${resolvedLeadId}). Riff with Aub here and dispatch or message the lead when approved.`
      : `You are the Brainstorm chat for ${resolvedArea} (${cwd}). Riff with Aub here and dispatch or start a lead when approved.`;

  const handle = await paseo.agents.create({
    cwd,
    title,
    labels: { role: "brainstorm", lead: slug },
    config,
    prompt,
  });
  return {
    ok: true,
    reused: false,
    message: `Created ${title} (${matched?.name ?? providerSpec}, ${modeId})`,
    agentId: handle.id,
  };
}

export async function updateAgentLabels(agentId: string, labels: readonly string[]): Promise<boolean> {
  const args = ["agent", "update", agentId, ...labels.flatMap((l) => ["--label", l])];
  for (const command of paseoCandidates()) {
    try {
      await execCommand(command, args, { timeout: 30_000 });
      return true;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code !== "ENOENT") break;
    }
  }
  return false;
}

export async function checkInLeads(paseo: PaseoApi, cfg: BoardConfig) {
  const listed = await paseo.agents
    .list({
      includeBackground: true,
      filter: { includeBackground: true },
      page: { limit: AGENT_PAGE_LIMIT },
    })
    .catch(() => null);
  const live = (listed?.entries ?? [])
    .map((e) => e.agent)
    .filter((a) => !a.archivedAt && a.status !== "closed");
  const brainstorms = live.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg));
  const idleLeads = live.filter((a) => a.status === "idle" && isLeadAgent(a.title, a.labels ?? {}, cfg));

  let prompted = 0;
  for (const lead of idleLeads) {
    if (!matchBrainstormForLead(lead, brainstorms, cfg)) {
      try {
        await paseo.agents
          .ref(lead.id)
          .send("Anything for Aub? If yes, set the needs-aub label with a reason; if no, reply 'nothing'.");
        prompted++;
      } catch {
        // ignore send error
      }
    }
  }
  return {
    ok: true,
    count: prompted,
    message:
      prompted > 0
        ? `Checked in with ${prompted} idle lead${prompted === 1 ? "" : "s"}`
        : "No idle leads without a brainstorm",
  };
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

  constructor(private readonly getConfig: () => BoardConfig) {}

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
    const live = (listed?.entries ?? [])
      .map((e) => e.agent)
      .filter((a) => !a.archivedAt && a.status !== "closed");
    const leads = live.filter((a) => isLeadAgent(a.title, a.labels ?? {}, cfg));
    const brainstorms = live.filter((a) => isBrainstormAgent(a.title, a.labels ?? {}, cfg));

    for (const lead of leads) {
      const reason = unhandledNeedsAubReason(lead.labels);
      if (reason && cfg.needsAubAutoSpawn && !this.inFlight.has(lead.id)) {
        this.inFlight.add(lead.id);
        try {
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
          await updateAgentLabels(lead.id, [
            `${NEEDS_AUB_LABEL}=handled`,
            `${NEEDS_AUB_REASON_LABEL}=${reason}`,
            `${NEEDS_AUB_AT_LABEL}=${flaggedAt}`,
          ]);
        } catch (error) {
          console.error(
            `auto-spawn brainstorm for ${lead.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          this.inFlight.delete(lead.id);
        }
      } else if (lead.labels?.[NEEDS_AUB_LABEL]?.toLowerCase() === "handled") {
        const brainstorm = matchBrainstormForLead(lead, brainstorms, cfg);
        if (brainstorm && aubMayHaveReplied(lead.labels, brainstorm.lastUserMessageAt)) {
          // lastUserMessageAt also counts agent-sent prompts; confirm a human-typed message in the timeline.
          const tail = await p.agents
            .ref(brainstorm.id)
            .timeline.refetch({ direction: "tail", limit: 40 })
            .then((page) => page.entries)
            .catch(() => undefined);
          if (aubReplied(lead.labels, brainstorm.lastUserMessageAt, tail)) {
            // Only now are the stamp and reason blanked, so a later re-flag starts clean.
            await updateAgentLabels(lead.id, [
              `${NEEDS_AUB_LABEL}=cleared`,
              `${NEEDS_AUB_AT_LABEL}=`,
              `${NEEDS_AUB_REASON_LABEL}=`,
            ]);
          }
        }
      }
    }
  }
}
