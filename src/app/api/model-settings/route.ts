import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { publicFailure } from "@/lib/api-error";
import { recordServerError } from "@/lib/server-error";
import { encryptModelKey } from "@/lib/model-credentials";
import { getSavedModelSettings, isModelProvider, publicModelSettings } from "@/lib/model-settings";

function failure(error: unknown) {
  return recordServerError("model-settings", error).then((errorId) =>
    NextResponse.json({ error: publicFailure("MODEL_SETTINGS_UNAVAILABLE").error, code: "MODEL_SETTINGS_UNAVAILABLE", errorId }, { status: 503 }));
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(publicModelSettings(await getSavedModelSettings(userId)));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { provider?: unknown; model?: unknown; apiKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || !isModelProvider(body.provider) || typeof body.model !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/.test(body.model.trim())) {
    return NextResponse.json({ error: "Choose OpenRouter or OpenAI and enter a valid model ID." }, { status: 400 });
  }
  const { provider } = body;
  const model = body.model.trim();
  const newKey = body.apiKey;
  if (newKey !== undefined && (typeof newKey !== "string" ||
      newKey.length < 20 || newKey.length > 512 || /\s/.test(newKey))) {
    return NextResponse.json({ error: "Enter a valid API key without spaces." }, { status: 400 });
  }

  try {
    const current = await getSavedModelSettings(userId);
    if (!newKey && !current.keys[provider]) {
      return NextResponse.json({ error: "Add an API key for this provider first." }, { status: 400 });
    }
    const update = {
      selection: { provider, model },
      ...(typeof newKey === "string" ? { keys: { [provider]: encryptModelKey(newKey, userId, provider) } } : {}),
    };
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, { privateMetadata: { livePodcastModels: update } });
    return NextResponse.json(publicModelSettings({
      keys: { ...current.keys, ...(typeof newKey === "string" ? { [provider]: "saved" } : {}) },
      selection: { provider, model },
    }));
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const provider = new URL(request.url).searchParams.get("provider");
  if (!isModelProvider(provider)) {
    return NextResponse.json({ error: "Choose OpenRouter or OpenAI." }, { status: 400 });
  }
  try {
    const current = await getSavedModelSettings(userId);
    const active = current.selection?.provider === provider;
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      privateMetadata: { livePodcastModels: {
        keys: { [provider]: null },
        ...(active ? { selection: null } : {}),
      } },
    });
    const keys = { ...current.keys };
    delete keys[provider];
    return NextResponse.json(publicModelSettings({ keys, selection: active ? undefined : current.selection }));
  } catch (error) {
    return failure(error);
  }
}
