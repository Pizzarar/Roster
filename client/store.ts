import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useEffect, useSyncExternalStore } from "react";
import {
  AGENT_PAGE_LIMIT,
  SUBAGENT_MAX_CONCURRENT,
  SUBAGENT_POLL_MS,
  SUBAGENT_TIMELINE_TAIL,
} from "../shared/config";
import { handoffStateRpc, type HandoffRecord } from "../shared/handoff";
import type { BoardAgent } from "./model";

type PaseoApi = PluginClientContext["paseo"];
type Rpc = PluginClientContext["rpc"];

const HANDOFF_POLL_MS = 20_000;

export interface HandoffState {
  /** Moved worker id -> the lead that now hears about it. */
  readonly relays: Readonly<Record<string, string>>;
  /** Newest first. */
  readonly handoffs: readonly HandoffRecord[];
}

export interface SubagentCount {
  readonly running: number;
  readonly total: number;
}

export interface BoardState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly error: string | null;
  /** Live, non-archived agents from the one owned subscription. */
  readonly agents: ReadonlyMap<string, BoardAgent>;
  /** The daemon had more agents than one page holds. */
  readonly truncated: boolean;
  readonly includeBackground: boolean;
  /** Archived agents; null until requested. */
  readonly archived: readonly BoardAgent[] | null;
  readonly archivedStatus: "idle" | "loading" | "ready" | "error";
  readonly subagents: ReadonlyMap<string, SubagentCount>;
  readonly handoffs: HandoffState;
}

const INITIAL: BoardState = {
  status: "idle",
  error: null,
  agents: new Map(),
  truncated: false,
  includeBackground: false,
  archived: null,
  archivedStatus: "idle",
  subagents: new Map(),
  handoffs: { relays: {}, handoffs: [] },
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One owned `agents.list` subscription shared by the sidebar item and the screen.
 * Read-only: it never sends, cancels, archives or kills agents.
 */
class AgentBoardStore {
  private state: BoardState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private paseo: PaseoApi | null = null;
  private rpc: Rpc | null = null;
  private handoffTimer: ReturnType<typeof setInterval> | null = null;
  private lifetime: AbortController | null = null;
  private release: (() => Promise<void>) | null = null;
  private generation = 0;

  private readonly watches = new Map<number, readonly string[]>();
  private nextWatch = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.state;

  private set(patch: Partial<BoardState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  start(paseo: PaseoApi, rpc: Rpc) {
    this.paseo = paseo;
    this.rpc = rpc;
    void this.open();
    void this.refreshHandoffs();
    this.handoffTimer = setInterval(() => void this.refreshHandoffs(), HANDOFF_POLL_MS);
  }

  /** Re-read what the daemon side has rerouted. Cheap; it reads plugin memory. */
  async refreshHandoffs() {
    const rpc = this.rpc;
    if (!rpc) return;
    const generation = this.generation;
    try {
      const handoffs = await rpc(handoffStateRpc, {});
      if (generation === this.generation) this.set({ handoffs });
    } catch {
      // The server side may be reloading; keep the last state.
    }
  }

  async stop() {
    this.generation += 1;
    this.lifetime?.abort();
    this.lifetime = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.handoffTimer) clearInterval(this.handoffTimer);
    this.handoffTimer = null;
    this.rpc = null;
    this.watches.clear();
    const release = this.release;
    this.release = null;
    this.paseo = null;
    this.state = INITIAL;
    await release?.().catch(() => undefined);
  }

  setIncludeBackground(includeBackground: boolean) {
    if (includeBackground === this.state.includeBackground) return;
    this.set({ includeBackground, archived: null, archivedStatus: "idle" });
    void this.open();
  }

  retry() {
    void this.open();
  }

  private async open() {
    const paseo = this.paseo;
    if (!paseo) return;
    const generation = ++this.generation;
    this.lifetime?.abort();
    const previous = this.release;
    this.release = null;
    void previous?.().catch(() => undefined);
    const lifetime = new AbortController();
    this.lifetime = lifetime;
    const includeBackground = this.state.includeBackground;
    this.set({ status: "loading", error: null });
    try {
      const result = await paseo.agents.list({
        subscribe: {},
        signal: lifetime.signal,
        includeBackground,
        filter: { includeBackground },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: AGENT_PAGE_LIMIT },
      });
      const { subscription } = result;
      if (generation !== this.generation) {
        void subscription.release().catch(() => undefined);
        return;
      }
      this.release = () => subscription.release();
      const replace = (entries: readonly { agent: BoardAgent }[], hasMore: boolean) => {
        const agents = new Map<string, BoardAgent>();
        for (const { agent } of entries) {
          if (!agent.archivedAt) agents.set(agent.id, agent);
        }
        this.set({ status: "ready", error: null, agents, truncated: hasMore });
      };
      replace(result.entries, result.pageInfo.hasMore);
      subscription.subscribe({
        snapshot: (snapshot) => {
          if (generation === this.generation) replace(snapshot.entries, snapshot.pageInfo.hasMore);
        },
        update: (update) => {
          if (generation !== this.generation || update.type !== "agent_update") return;
          const payload = update.payload;
          const agents = new Map(this.state.agents);
          if (payload.kind === "upsert" && !payload.agent.archivedAt) {
            agents.set(payload.agent.id, payload.agent);
          } else {
            agents.delete(payload.kind === "upsert" ? payload.agent.id : payload.agentId);
          }
          this.set({ agents });
        },
        error: (error) => {
          if (generation === this.generation) this.set({ status: "error", error: message(error) });
        },
      });
    } catch (error) {
      if (generation === this.generation && !lifetime.signal.aborted) {
        this.set({ status: "error", error: message(error) });
      }
    }
  }

  /** One-shot fetch of recent archived agents. Not live. */
  async loadArchived() {
    const paseo = this.paseo;
    if (!paseo || this.state.archivedStatus === "loading") return;
    const generation = this.generation;
    const includeBackground = this.state.includeBackground;
    this.set({ archivedStatus: "loading" });
    try {
      const result = await paseo.agents.list({
        includeBackground,
        filter: { includeArchived: true, includeBackground },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: AGENT_PAGE_LIMIT },
      });
      if (generation !== this.generation) return;
      const archived = result.entries
        .map(({ agent }) => agent)
        .filter((agent) => agent.archivedAt);
      this.set({ archived, archivedStatus: "ready" });
    } catch {
      if (generation === this.generation) this.set({ archivedStatus: "error" });
    }
  }

  /** Count provider sub-agents for these agents while the caller is mounted. */
  watchSubagents(agentIds: readonly string[]): () => void {
    const token = this.nextWatch++;
    this.watches.set(token, agentIds);
    if (!this.pollTimer) this.pollTimer = setInterval(() => void this.poll(), SUBAGENT_POLL_MS);
    void this.poll();
    return () => {
      this.watches.delete(token);
      if (this.watches.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private async poll() {
    const paseo = this.paseo;
    if (!paseo || this.polling) return;
    this.polling = true;
    const generation = this.generation;
    try {
      const ids = new Set<string>();
      for (const list of this.watches.values()) for (const id of list) ids.add(id);
      const counts = new Map(this.state.subagents);
      const queue: string[] = [];
      for (const id of ids) {
        const agent = this.state.agents.get(id);
        if (agent?.status === "running") queue.push(id);
        else if (counts.has(id)) counts.set(id, { running: 0, total: counts.get(id)!.total });
      }
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          try {
            const page = await paseo.agents.ref(id).timeline.refetch({
              direction: "tail",
              limit: SUBAGENT_TIMELINE_TAIL,
              projection: "projected",
            });
            let running = 0;
            let total = 0;
            for (const { item } of page.entries) {
              if (item.type !== "tool_call" || item.detail.type !== "sub_agent") continue;
              total += 1;
              if (item.status === "running") running += 1;
            }
            counts.set(id, { running, total });
          } catch {
            // A busy daemon can time out; keep the last count.
          }
        }
      };
      await Promise.all(Array.from({ length: SUBAGENT_MAX_CONCURRENT }, worker));
      if (generation === this.generation) this.set({ subagents: counts });
    } finally {
      this.polling = false;
    }
  }
}

export const boardStore = new AgentBoardStore();

export function useBoard(): BoardState {
  return useSyncExternalStore(boardStore.subscribe, boardStore.getSnapshot, boardStore.getSnapshot);
}

/** Poll sub-agent counts for `agentIds` while mounted. */
export function useSubagentWatch(agentIds: readonly string[]) {
  const key = agentIds.join(",");
  useEffect(() => {
    if (!key) return undefined;
    return boardStore.watchSubagents(key.split(","));
  }, [key]);
}

/** Re-render on a clock so "5m ago" stays current. */
export function useNow(intervalMs = 30_000): number {
  return useSyncExternalStore(
    (listener) => {
      const timer = setInterval(listener, intervalMs);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
  );
}
