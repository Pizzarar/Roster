import type {
  PluginTimelineItemProps,
  PluginTimelineRendererContribution,
  PluginTimelineTransformerContribution,
} from "@getpaseo/plugin/client";
import { Markdown } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { z } from "zod";

export const TIMELINE_IMAGE_KIND = "roster.inline-image";
export const TIMELINE_IMAGE_VERSION = 1;

export const timelineImageSchema = z.object({
  caption: z.string().optional(),
  markdown: z.string(),
});

export type TimelineImageData = z.output<typeof timelineImageSchema>;

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;

export function toFileUrl(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^[`"']+|[`"']+$/g, "");
  if (/^file:\/\/\//i.test(trimmed)) {
    return trimmed.replace(/\\/g, "/").replace(/ /g, "%20");
  }
  const forward = trimmed.replace(/^file:\/\//i, "").replace(/\\/g, "/");
  const withLeadingSlash = forward.startsWith("/") ? forward : `/${forward}`;
  return `file://${withLeadingSlash.replace(/ /g, "%20")}`;
}

function isImagePath(candidate: string): boolean {
  return IMAGE_EXT_RE.test(candidate.trim());
}

type ToolCallItem = Parameters<PluginTimelineTransformerContribution<"tool_call">["transform"]>[0]["item"];

function extractReadImagePath(item: ToolCallItem): string | null {
  if (item.detail.type === "read" && item.detail.content === "[image]") {
    return null;
  }
  if (item.detail.type === "read") {
    return isImagePath(item.detail.filePath) ? item.detail.filePath : null;
  }
  if (!/^(?:read_file|read|view_file|mcp_.*read.*)$/i.test(item.name)) {
    return null;
  }
  const params = (item.metadata as { parameters?: Record<string, unknown> } | undefined)?.parameters;
  const paramPath = params?.Path ?? params?.path ?? params?.file_path ?? params?.filePath;
  if (typeof paramPath === "string" && isImagePath(paramPath)) {
    return paramPath;
  }
  if (item.detail.type === "plain_text" && item.detail.text) {
    const match = item.detail.text.match(/\bPath=([^\r\n…]+?\.(?:png|jpe?g|gif|webp|bmp|svg))\b/i);
    if (match?.[1] && isImagePath(match[1])) {
      return match[1];
    }
  }
  return null;
}

export const toolCallImageTransformer: PluginTimelineTransformerContribution<"tool_call"> = {
  id: "roster-tool-call-image",
  query: { itemType: "tool_call" },
  transform({ item, phase }) {
    if (phase !== "complete" || item.status !== "completed") return undefined;
    const filePath = extractReadImagePath(item);
    if (!filePath) return undefined;
    const fileUrl = toFileUrl(filePath);
    const shortName = filePath.split(/[\\/]+/).pop() || filePath;
    return {
      items: [
        {
          type: "plugin",
          id: `${item.callId}:image`,
          kind: TIMELINE_IMAGE_KIND,
          version: TIMELINE_IMAGE_VERSION,
          data: {
            caption: `[Read] ${shortName}`,
            markdown: `![${shortName}](${fileUrl})`,
          },
        },
      ],
    };
  },
};

export function upgradeAssistantImages(text: string): string | null {
  let changed = false;
  let next = text;

  // Unwrap Antigravity 4-backtick carousel blocks so Markdown renders the images inside them
  next = next.replace(/`{4}carousel\r?\n([\s\S]*?)`{4}/g, (_match, body: string) => {
    changed = true;
    return body.replace(/<!--\s*slide\s*-->/g, "\n\n");
  });

  // Upgrade ![alt](C:\...\img.png) or ![alt](/abs/path.png) to file:/// URLs
  next = next.replace(
    /!\[([^\]]*)\]\(((?:[A-Za-z]:[\\/]|\/[^/\s)])[^)\r\n]*?\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
    (_match, alt: string, rawPath: string) => {
      changed = true;
      return `![${alt.trim() || "Image"}](${toFileUrl(rawPath)})`;
    },
  );

  // Upgrade non-embedded Markdown links [label](file:///...png) or [label](C:\...png) to ![label](file:///...png)
  next = next.replace(
    /(?<!\!)\[([^\]]*)\]\(((?:file:\/\/\/|[A-Za-z]:[\\/])[^)\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))\)/gi,
    (_match, label: string, rawTarget: string) => {
      changed = true;
      const url = /^file:\/\/\//i.test(rawTarget) ? rawTarget.replace(/\\/g, "/") : toFileUrl(rawTarget);
      return `![${label.trim() || "Image"}](${url})`;
    },
  );

  // Append inline image embeds for standalone backticked absolute image paths not already embedded
  const appendedUrls = new Set<string>();
  const backtickRe = /`([A-Za-z]:[\\/][^`\r\n]+?\.(?:png|jpe?g|gif|webp|bmp|svg))`/gi;
  let match: RegExpExecArray | null;
  while ((match = backtickRe.exec(next)) !== null) {
    const rawPath = match[1];
    if (!rawPath) continue;
    const url = toFileUrl(rawPath);
    if (!next.includes(`(${url})`) && !appendedUrls.has(url)) {
      appendedUrls.add(url);
    }
  }
  if (appendedUrls.size > 0) {
    changed = true;
    const embeds = [...appendedUrls].map((url) => `![Image](${url})`).join("\n\n");
    next = `${next}\n\n${embeds}`;
  }

  return changed ? next : null;
}

export const assistantMessageImageTransformer: PluginTimelineTransformerContribution<"assistant_message"> = {
  id: "roster-assistant-message-image",
  query: { itemType: "assistant_message" },
  transform({ item, phase }) {
    if (phase !== "complete") return undefined;
    const upgraded = upgradeAssistantImages(item.text);
    if (!upgraded) return undefined;
    return {
      items: [
        {
          type: "plugin",
          ...(item.messageId ? { id: `${item.messageId}:image` } : {}),
          kind: TIMELINE_IMAGE_KIND,
          version: TIMELINE_IMAGE_VERSION,
          data: {
            markdown: upgraded,
          },
        },
      ],
    };
  },
};

export function TimelineImageRenderer({ item, theme }: PluginTimelineItemProps<TimelineImageData>) {
  return (
    <View style={{ gap: 4 }}>
      {item.data.caption ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{item.data.caption}</Text>
      ) : null}
      <Markdown>{item.data.markdown}</Markdown>
    </View>
  );
}

export const timelineImageRendererContribution: PluginTimelineRendererContribution<typeof timelineImageSchema> = {
  kind: TIMELINE_IMAGE_KIND,
  version: TIMELINE_IMAGE_VERSION,
  schema: timelineImageSchema,
  Component: TimelineImageRenderer,
};
