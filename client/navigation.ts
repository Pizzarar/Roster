import type { PluginScreenProps } from "@getpaseo/plugin/client";

export type Navigation = NonNullable<PluginScreenProps["navigation"]>;

export const BOARD_SCREEN = "board";
/** Sidebar items get no `navigation`; this screen opens the agent from a screen context. */
export const OPEN_AGENT_SCREEN = "open-agent";

/** Sidebar props are not typed with navigation; use it if a host supplies it anyway. */
export function navigationOf(props: object): Navigation | undefined {
  const navigation = (props as { navigation?: Partial<Navigation> }).navigation;
  return typeof navigation?.openAgent === "function" ? (navigation as Navigation) : undefined;
}

export const WORKSPACES_SCREEN = "workspaces";
