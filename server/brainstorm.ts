import type { RpcInput } from "@getpaseo/plugin";
import { execCommand, type PluginServerContext } from "@getpaseo/plugin/server";
import { resolveProviderAutoMode, type createBrainstormRpc, type renameBrainstormRpc } from "../shared/brainstorm";
import { AGENT_PAGE_LIMIT, isBrainstormAgent, isLeadAgent, normalizePath, type BoardConfig } from "../shared/config";

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
  }: RpcInput<typeof createBrainstormRpc>,
  paseo: PaseoApi,
  cfg: BoardConfig,
) {
  const cwdNorm = normalizePath(cwd);
  const rootNorm = projectRootPath ? normalizePath(projectRootPath) : "";
  let matchedLead:
    | { id: string; title: string | null; cwd: string; labels?: Record<string, string> }
    | undefined;

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

    if (reuseExisting) {
      const existing = liveAgents.find(
        (a) =>
          isBrainstormAgent(a.title, a.labels ?? {}, cfg) &&
          ((workspaceId && a.workspaceId === workspaceId) || normalizePath(a.cwd) === cwdNorm),
      );
      if (existing) {
        return {
          ok: true,
          reused: true,
          message: `Opened ${existing.title ?? "brainstorm"}`,
          agentId: existing.id,
        };
      }
    }

    if (!leadId) {
      matchedLead = liveAgents.find(
        (a) =>
          isLeadAgent(a.title, a.labels ?? {}, cfg) &&
          (normalizePath(a.cwd) === cwdNorm || (rootNorm !== "" && normalizePath(a.cwd) === rootNorm)),
      );
    }
  }

  const resolvedLeadId = leadId?.trim() || matchedLead?.id;
  const resolvedLeadTitle =
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

  const prompt = resolvedLeadId
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
