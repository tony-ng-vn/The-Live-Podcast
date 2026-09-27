import { clerkClient } from "@clerk/nextjs/server";
import type { ModelProvider } from "./model-credentials";

export interface ModelSelection {
  provider: ModelProvider;
  model: string;
}

export interface SavedModelSettings {
  keys: Partial<Record<ModelProvider, string>>;
  selection?: ModelSelection;
}

export function isModelProvider(value: unknown): value is ModelProvider {
  return value === "openrouter" || value === "openai";
}

export function readSavedModelSettings(metadata: unknown): SavedModelSettings {
  if (!metadata || typeof metadata !== "object") return { keys: {} };
  const stored = (metadata as Record<string, unknown>).livePodcastModels;
  if (!stored || typeof stored !== "object") return { keys: {} };
  const data = stored as Record<string, unknown>;
  const rawKeys = data.keys && typeof data.keys === "object" ? data.keys as Record<string, unknown> : {};
  const keys: SavedModelSettings["keys"] = {};
  for (const provider of ["openrouter", "openai"] as const) {
    if (typeof rawKeys[provider] === "string") keys[provider] = rawKeys[provider];
  }
  const rawSelection = data.selection;
  const selection = rawSelection && typeof rawSelection === "object"
    ? rawSelection as Record<string, unknown>
    : {};
  return {
    keys,
    selection: isModelProvider(selection.provider) && typeof selection.model === "string"
      ? { provider: selection.provider, model: selection.model }
      : undefined,
  };
}

export async function getSavedModelSettings(userId: string): Promise<SavedModelSettings> {
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  return readSavedModelSettings(user.privateMetadata);
}

export function publicModelSettings(settings: SavedModelSettings) {
  return {
    provider: settings.selection?.provider ?? null,
    model: settings.selection?.model ?? null,
    hasKeys: {
      openrouter: Boolean(settings.keys.openrouter),
      openai: Boolean(settings.keys.openai),
    },
  };
}
