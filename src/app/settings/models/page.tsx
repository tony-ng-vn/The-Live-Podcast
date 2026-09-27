"use client";

import { useEffect, useState, type FormEvent } from "react";
import { publicFailure, readApiError, PublicRequestError } from "@/lib/api-error";

type Provider = "openrouter" | "openai";
type ModelSettings = {
  provider: Provider | null;
  model: string | null;
  hasKeys: Record<Provider, boolean>;
};

const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: "openai/gpt-4o-mini",
  openai: "gpt-4o-mini",
};

export default function ModelSettingsPage() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [provider, setProvider] = useState<Provider>("openrouter");
  const [model, setModel] = useState(DEFAULT_MODELS.openrouter);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/model-settings");
        if (!response.ok) throw new PublicRequestError(await readApiError(response, "MODEL_SETTINGS_UNAVAILABLE"));
        const saved = await response.json() as ModelSettings;
        if (!active) return;
        setSettings(saved);
        if (saved.provider) {
          setProvider(saved.provider);
          setModel(saved.model || DEFAULT_MODELS[saved.provider]);
        }
      } catch (error) {
        if (active) setMessage(error instanceof PublicRequestError ? error.message : publicFailure("MODEL_SETTINGS_UNAVAILABLE").error);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  function chooseProvider(next: Provider) {
    setProvider(next);
    setModel(settings?.provider === next && settings.model ? settings.model : DEFAULT_MODELS[next]);
    setApiKey("");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/model-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: model.trim(), ...(apiKey ? { apiKey } : {}) }),
      });
      if (!response.ok) throw new PublicRequestError(await readApiError(response, "MODEL_SETTINGS_UNAVAILABLE"));
      setSettings(await response.json() as ModelSettings);
      setApiKey("");
      setMessage("Your model settings are saved.");
    } catch (error) {
      setMessage(error instanceof PublicRequestError ? error.message : publicFailure("MODEL_SETTINGS_UNAVAILABLE").error);
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/model-settings?provider=${provider}`, { method: "DELETE" });
      if (!response.ok) throw new PublicRequestError(await readApiError(response, "MODEL_SETTINGS_UNAVAILABLE"));
      setSettings(await response.json() as ModelSettings);
      setApiKey("");
      setMessage(`${provider === "openai" ? "OpenAI" : "OpenRouter"} key removed.`);
    } catch (error) {
      setMessage(error instanceof PublicRequestError ? error.message : publicFailure("MODEL_SETTINGS_UNAVAILABLE").error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Model settings</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        Add your own API key and choose which model answers your questions about a video.
        Your key is encrypted before it is saved. Your model provider may charge your account for use.
      </p>

      {loading ? <p className="mt-8" role="status">Loading model settings...</p> : (
        <form onSubmit={save} className="mt-8 space-y-6 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
          <div>
            <label htmlFor="model-provider" className="block font-medium">Model provider</label>
            <select id="model-provider" value={provider} onChange={(event) => chooseProvider(event.target.value as Provider)}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50">
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
            </select>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {settings?.hasKeys[provider] ? "A key is saved for this provider." : "No key is saved for this provider."}
            </p>
          </div>

          <div>
            <label htmlFor="model-id" className="block font-medium">Model ID</label>
            <input id="model-id" value={model} onChange={(event) => setModel(event.target.value)} required
              autoComplete="off" spellCheck={false}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Enter a model ID available to your account. Find IDs in the {provider === "openai" ? (
                <a className="underline" href="https://platform.openai.com/docs/models" target="_blank" rel="noreferrer">OpenAI model list</a>
              ) : (
                <a className="underline" href="https://openrouter.ai/models" target="_blank" rel="noreferrer">OpenRouter model list</a>
              )}.
            </p>
          </div>

          <div>
            <label htmlFor="model-api-key" className="block font-medium">API key</label>
            <input id="model-api-key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off" spellCheck={false} placeholder={settings?.hasKeys[provider] ? "Leave blank to keep saved key" : "Paste your API key"}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">A saved key cannot be shown again. Paste a new one to replace it.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={saving} className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
              {saving ? "Saving..." : "Save model settings"}
            </button>
            {settings?.hasKeys[provider] && (
              <button type="button" onClick={removeKey} disabled={saving}
                className="rounded-md border border-zinc-300 px-4 py-2 font-medium disabled:opacity-50 dark:border-zinc-700">
                Remove saved key
              </button>
            )}
          </div>
        </form>
      )}
      <p className="mt-5" role="status" aria-live="polite">{message}</p>
    </main>
  );
}
