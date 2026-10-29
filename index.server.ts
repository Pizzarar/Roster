import type { PluginServerContext } from "@getpaseo/plugin/server";
import { stopAgent } from "./server/stop";
import { rosterSettings } from "./shared/settings";
import { stopAgentRpc } from "./shared/stop";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(rosterSettings);
  server.handle(stopAgentRpc, stopAgent);
  return () => {};
}