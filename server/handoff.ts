import type { PluginHookAgent, PluginServerContext, PluginSettings } from "@getpaseo/plugin/server";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { compileConfig, DEFAULT_CONFIG, isLeadAgent, PARENT_LABEL, type BoardConfig } from "../shared/config";
import type { HandoffRecord } from "../shared/handoff";
import type { rosterSettings } from "../shared/settings";

type PaseoApi = Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"];

/** The agent fields the handoff logic reads. */
interface Snapshot {
  readonly id: string;
  readonly title: string | null;
  readonly status: string;
  readonly archivedAt?: string | null;
  readonly internal?: boolean;
  readonly labels: Readonly<Record<string, string>>;
}

interface State {
  /** old lead id -> the lead that succeeded it. */
  successors: Record<string, string>;
  /** moved worker id -> the lead it was moved to (resolve through successors). */
  relays: Record<string, string>;
  handoffs: HandoffRecord[];
}

const MAX_HANDOFFS = 50;
const LAST_MESSAGE_CHARS = 4000;
const PAGE_LIMIT = 500;

function stateFile(): string {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(home, "plugin-data", "roster", "handoffs.json");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quote(snapshot: Pick<Snapshot, "id" | "title">): string {
  return `"${snapshot.title?.trim() || snapshot.id.slice(0, 8)}" (${snapshot.id.slice(0, 8)})`;
}

/**
 * Lead handoffs. A lead that spawns its successor makes the successor its child, so the
 * old lead keeps getting woken for the successor and its own workers. On a handoff this
 * detaches the successor, detaches the old lead's live workers, and forwards those
 * workers' events to whichever lead currently owns them.
 */
export class Handoffs {
  private state: State = { successors: {}, relays: {}, handoffs: [] };
  private cfg: BoardConfig = DEFAULT_CONFIG;
  private queue: Promise<unknown> = Promise.resolve();
  /** Agents already checked for a handoff; a turn start re-checks only unseen ones. */
  private readonly checked = new Set<string>();
  private readonly ready: Promise<void>;

  constructor(private readonly settings: PluginSettings<typeof rosterSettings.schema>) {
    this.ready = this.load();
  }

  async start(): Promise<() => void> {
    const apply = (state: Awaited<ReturnType<typeof this.settings.read>>) => {
      this.cfg = state.status === "ready" ? compileConfig(state.values) : DEFAULT_CONFIG;
    };
    apply(await this.settings.read());
    return this.settings.subscribe(apply);
  }

  /** Serialise every mutation so state writes and detaches never interleave. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.ready).then(task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load() {
    try {
      const parsed = JSON.parse(await readFile(stateFile(), "utf8")) as Partial<State>;
      this.state = {
        successors: parsed.successors ?? {},
        relays: parsed.relays ?? {},
        handoffs: parsed.handoffs ?? [],
      };
    } catch {
      // First run, or an unreadable file: start empty.
    }
  }

  private async save() {
    const file = stateFile();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(this.state, null, 2), "utf8");
    await rename(`${file}.tmp`, file);
  }

  /** Follow successors from `leadId` to the lead that owns its work today. */
  private currentLead(leadId: string): string {
    const seen = new Set<string>();
    let current = leadId;
    while (this.state.successors[current] && !seen.has(current)) {
      seen.add(current);
      current = this.state.successors[current]!;
    }
    return current;
  }

  async snapshot() {
    await this.ready;
    const relays: Record<string, string> = {};
    for (const worker of Object.keys(this.state.relays)) {
      relays[worker] = this.currentLead(this.state.relays[worker]!);
    }
    return { relays, handoffs: [...this.state.handoffs].reverse() };
  }

  private async fetch(paseo: PaseoApi, id: string): Promise<Snapshot | null> {
    const result = await paseo.agents.ref(id).refresh();
    return (result?.agent as Snapshot | undefined) ?? null;
  }

  private async liveAgents(paseo: PaseoApi): Promise<Snapshot[]> {
    const result = await paseo.agents.list({
      includeBackground: true,
      filter: { includeBackground: true },
      page: { limit: PAGE_LIMIT },
    });
    return result.entries.map(({ agent }) => agent as Snapshot).filter((agent) => !agent.archivedAt);
  }

  /** A lead now, or a lead that has since been retired by title or role. */
  private wasLead(agent: Snapshot): boolean {
    if (isLeadAgent(agent.title, agent.labels, this.cfg)) return true;
    if (this.cfg.hideTitle?.test(agent.title ?? "")) return true;
    const role = agent.labels[this.cfg.labels.role];
    return role !== undefined && this.cfg.oldLeadRoles.includes(role);
  }

  // ---- lifecycle hooks -------------------------------------------------------------

  onCreated(agent: PluginHookAgent, paseo: PaseoApi) {
    return this.run(() => this.check(agent.id, paseo, "created")).catch((error) =>
      console.error(`handoff check for ${agent.id} failed: ${message(error)}`),
    );
  }

  /** A backstop for agents titled or labelled after creation. */
  onTurnStarted(agent: PluginHookAgent, paseo: PaseoApi) {
    if (!agent.parentAgentId || this.checked.has(agent.id)) return;
    return this.onCreated(agent, paseo);
  }

  onArchived(agent: PluginHookAgent) {
    return this.run(async () => {
      if (!(agent.id in this.state.relays)) return;
      delete this.state.relays[agent.id];
      await this.save();
    });
  }

  private async check(id: string, paseo: PaseoApi, why: string) {
    this.checked.add(id);
    const agent = await this.fetch(paseo, id);
    const parentId = agent?.labels[PARENT_LABEL];
    if (!agent || agent.archivedAt || agent.internal || !parentId) return;
    if (this.cfg.detachNewLeads && isLeadAgent(agent.title, agent.labels, this.cfg)) {
      await this.handoff(agent, parentId, paseo, why);
      return;
    }
    // A worker spawned by a lead that has already handed off belongs to the successor.
    if (this.cfg.adoptWorkers && this.state.successors[parentId]) {
      const lead = this.currentLead(parentId);
      if (lead === agent.id) return;
      await paseo.agents.ref(agent.id).detach();
      this.state.relays[agent.id] = lead;
      await this.save();
      console.log(`late worker ${quote(agent)} of retired lead ${parentId.slice(0, 8)} moved to ${lead.slice(0, 8)}`);
    }
  }

  /** Make `lead` independent of `parentId`, and hand it the parent's live workers. */
  private async handoff(lead: Snapshot, parentId: string, paseo: PaseoApi, why: string): Promise<number> {
    await paseo.agents.ref(lead.id).detach();
    console.log(`${why}: detached lead ${quote(lead)} from ${parentId.slice(0, 8)}`);

    const parent = await this.fetch(paseo, parentId).catch(() => null);
    const moved: string[] = [];
    if (this.cfg.adoptWorkers && parent && this.wasLead(parent)) {
      this.state.successors[parentId] = lead.id;
      for (const child of await this.liveAgents(paseo)) {
        if (child.id === lead.id || child.internal || child.labels[PARENT_LABEL] !== parentId) continue;
        // A sibling lead runs its own lane; detach it but do not take its events.
        if (isLeadAgent(child.title, child.labels, this.cfg)) continue;
        try {
          await paseo.agents.ref(child.id).detach();
          this.state.relays[child.id] = lead.id;
          moved.push(child.id);
        } catch (error) {
          console.error(`could not move worker ${quote(child)}: ${message(error)}`);
        }
      }
    }
    // Workers relayed to the old lead now report to the new one through `successors`.
    this.state.handoffs.push({ oldLeadId: parentId, newLeadId: lead.id, at: new Date().toISOString(), moved });
    this.state.handoffs = this.state.handoffs.slice(-MAX_HANDOFFS);
    await this.save();
    console.log(`handoff ${parentId.slice(0, 8)} -> ${lead.id.slice(0, 8)}: moved ${moved.length} worker(s)`);
    return moved.length;
  }

  // ---- RPCs ------------------------------------------------------------------------

  promote(id: string, paseo: PaseoApi) {
    return this.run(async () => {
      const agent = await this.fetch(paseo, id);
      if (!agent) return { ok: false, message: "Agent not found" };
      const parentId = agent.labels[PARENT_LABEL];
      if (!parentId) return { ok: false, message: `${quote(agent)} has no spawner to detach from` };
      const moved = await this.handoff(agent, parentId, paseo, "promote");
      return { ok: true, message: `Detached ${quote(agent)}; moved ${moved} worker(s)` };
    }).catch((error) => ({ ok: false, message: message(error) }));
  }

  fixChains(paseo: PaseoApi) {
    return this.run(async () => {
      const chained = (await this.liveAgents(paseo)).filter(
        (agent) => !agent.internal && agent.labels[PARENT_LABEL] && isLeadAgent(agent.title, agent.labels, this.cfg),
      );
      let workers = 0;
      const failures: string[] = [];
      for (const lead of chained) {
        try {
          workers += await this.handoff(lead, lead.labels[PARENT_LABEL]!, paseo, "fix-chains");
        } catch (error) {
          failures.push(`${quote(lead)}: ${message(error)}`);
        }
      }
      if (chained.length === 0) return { ok: true, message: "No chained leads" };
      const done = `Detached ${chained.length - failures.length} lead(s); moved ${workers} worker(s)`;
      return failures.length ? { ok: false, message: `${done}. Failed: ${failures.join("; ")}` } : { ok: true, message: done };
    }).catch((error) => ({ ok: false, message: message(error) }));
  }

  // ---- relay -----------------------------------------------------------------------

  /** Forward a moved worker's finished turn or failure to the lead that owns it now. */
  async relayTurnEnded(
    agent: PluginHookAgent,
    outcome: { kind: "completed" } | { kind: "failed"; error: { message: string } } | { kind: "canceled" },
    paseo: PaseoApi,
  ) {
    await this.ready;
    if (outcome.kind === "canceled" || !this.cfg.relayWorkerEvents || !this.state.relays[agent.id]) return;
    const detail = outcome.kind === "failed" ? `failed: ${outcome.error.message}` : "finished";
    let last = "";
    try {
      const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 20 });
      for (const { item } of page.entries) {
        if (item.type === "assistant_message" && item.text.trim()) last = item.text.trim();
      }
    } catch {
      // A busy daemon can time out; relay without the last message.
    }
    if (last.length > LAST_MESSAGE_CHARS) last = `${last.slice(0, LAST_MESSAGE_CHARS)}…`;
    await this.relay(agent, detail, last ? `\n\nLast message:\n${last}` : "", paseo);
  }

  async relayPermission(agent: PluginHookAgent, title: string, paseo: PaseoApi) {
    await this.relay(agent, `needs permission: ${title}`, "", paseo);
  }

  private async relay(agent: PluginHookAgent, detail: string, body: string, paseo: PaseoApi) {
    await this.ready;
    if (!this.cfg.relayWorkerEvents) return;
    const owner = this.state.relays[agent.id];
    if (!owner) return;
    const leadId = this.currentLead(owner);
    const lead = await this.fetch(paseo, leadId).catch(() => null);
    if (!lead || lead.archivedAt) {
      console.log(`relay for ${quote(agent)} dropped: lead ${leadId.slice(0, 8)} is gone`);
      return;
    }
    const text =
      `[Roster relay] Worker ${quote(agent)} ${detail}. ` +
      `It was handed to you when its original lead handed off; reply to it with paseo send ${agent.id}.${body}`;
    const ref = paseo.agents.ref(leadId);
    try {
      await ref.send(text, { activeTurnBehavior: "steer", sourceAgentId: agent.id });
    } catch {
      await ref.send(text, { activeTurnBehavior: "steer" });
    }
    console.log(`relayed ${quote(agent)} ${detail.split(":")[0]} to ${leadId.slice(0, 8)}`);
  }
}
