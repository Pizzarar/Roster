import { useSettings } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { compileConfig, DEFAULT_CONFIG, type BoardConfig } from "../shared/config";
import { rosterSettings } from "../shared/settings";

/** Saved settings, compiled; defaults while loading or when the stored document is invalid. */
export function useBoardConfig(): BoardConfig {
  const settings = useSettings(rosterSettings);
  const values = settings.status === "ready" ? settings.values : null;
  return useMemo(() => (values ? compileConfig(values) : DEFAULT_CONFIG), [values]);
}
