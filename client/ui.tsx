import type { PluginHostProps, PluginIconProps } from "@getpaseo/plugin/client";
import { useEffect, useState, type ComponentType } from "react";
import { Pressable, Text, View } from "react-native";
import type { AgentStatus, BoardAgent } from "./model";
import type { SubagentCount } from "./store";

type Theme = PluginHostProps["theme"];

export function statusColor(theme: Theme, status: AgentStatus): string {
  switch (status) {
    case "running":
      return theme.colors.statusSuccess;
    case "initializing":
      return theme.colors.statusWarning;
    case "error":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

const dotIcons = new Map<string, ComponentType<PluginIconProps>>();

/** A SidebarRow icon: a status dot centred in the icon box. Cached per colour. */
export function dotIcon(color: string): ComponentType<PluginIconProps> {
  let icon = dotIcons.get(color);
  if (!icon) {
    icon = function DotIcon({ size }: PluginIconProps) {
      return (
        <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
          <StatusDot color={color} size={Math.max(6, Math.round(size * 0.55))} />
        </View>
      );
    };
    dotIcons.set(color, icon);
  }
  return icon;
}

const ATTENTION_LABEL: Record<string, string> = {
  permission: "needs permission",
  error: "error",
  finished: "finished",
};

export function attentionLabel(agent: BoardAgent): string | null {
  if (!agent.requiresAttention) return null;
  return ATTENTION_LABEL[agent.attentionReason ?? ""] ?? "attention";
}

export function Chip({
  theme,
  label,
  tone = "muted",
}: {
  theme: Theme;
  label: string;
  tone?: "muted" | "warning" | "danger" | "accent";
}) {
  const color =
    tone === "warning"
      ? theme.colors.statusWarning
      : tone === "danger"
        ? theme.colors.statusDanger
        : tone === "accent"
          ? theme.colors.accent
          : theme.colors.foregroundMuted;
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: color,
        borderRadius: 999,
        paddingHorizontal: 6,
        paddingVertical: 1,
      }}
    >
      <Text style={{ color, fontSize: 11 }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function subagentLabel(count: SubagentCount | undefined): string | null {
  if (!count || count.running === 0) return null;
  return `${count.running} sub-agent${count.running === 1 ? "" : "s"}`;
}

/**
 * Two taps: the first arms it for a few seconds, the second runs `onConfirm`.
 * `tone` "danger" for destructive actions.
 */
export function ConfirmButton({
  theme,
  label,
  armedLabel,
  busyLabel,
  accessibilityLabel,
  tone = "danger",
  disabled = false,
  onConfirm,
}: {
  theme: Theme;
  label: string;
  armedLabel: string;
  busyLabel: string;
  accessibilityLabel: string;
  tone?: "danger" | "accent";
  disabled?: boolean;
  onConfirm(): Promise<unknown>;
}) {
  const [state, setState] = useState<"idle" | "armed" | "busy">("idle");
  useEffect(() => {
    if (state !== "armed") return undefined;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);
  const color = disabled ? theme.colors.foregroundMuted : tone === "danger" ? theme.colors.statusDanger : theme.colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={state === "armed" ? `Confirm: ${accessibilityLabel}` : accessibilityLabel}
      accessibilityState={{ disabled: disabled || state === "busy" }}
      disabled={disabled || state === "busy"}
      onPress={() => {
        if (state === "idle") setState("armed");
        else if (state === "armed") {
          setState("busy");
          void onConfirm().finally(() => setState("idle"));
        }
      }}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: state === "armed" ? color : "transparent",
      }}
    >
      <Text style={{ fontSize: 12, color: state === "armed" ? theme.colors.surface0 : color }}>
        {state === "armed" ? armedLabel : state === "busy" ? busyLabel : label}
      </Text>
    </Pressable>
  );
}
