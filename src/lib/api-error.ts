const PUBLIC_FAILURES = {
  REQUEST_UNAVAILABLE: { status: 503, message: "That request did not finish. Please try again." },
  SIGN_IN_UNAVAILABLE: { status: 503, message: "I could not check your sign-in right now. Please try again." },
  LIBRARY_UNAVAILABLE: { status: 503, message: "Your library could not load right now. Please refresh to try again." },
  VIDEO_LOAD_UNAVAILABLE: { status: 503, message: "This video could not load right now. Please try opening it again." },
  VIDEO_SAVE_UNAVAILABLE: { status: 503, message: "I could not finish adding this video. Check your library before trying again." },
  TRANSCRIPT_UNAVAILABLE: { status: 503, message: "I could not fetch this video's captions right now. Please try adding it again later." },
  TRANSCRIPT_TIMING_UNAVAILABLE: { status: 422, message: "These captions do not have usable timing yet. Try another video, or try this one again later." },
  TRANSCRIPT_NOT_FOUND: { status: 422, message: "This video does not have captions I can read yet." },
  MODEL_KEY_REQUIRED: { status: 400, message: "Add an API key in Model settings before chatting.", modelSettingsNeeded: true },
  MODEL_KEY_INVALID: { status: 422, message: "Your model connection needs attention. Check the saved API key in Model settings.", modelSettingsNeeded: true },
  MODEL_CREDITS_REQUIRED: { status: 422, message: "Your model account cannot process this request right now. Check its available credits or choose another model in Model settings.", modelSettingsNeeded: true },
  MODEL_RATE_LIMITED: { status: 429, message: "That model is busy or has reached its request limit. Try again later or choose another model in Model settings.", modelSettingsNeeded: true },
  MODEL_UNAVAILABLE: { status: 503, message: "The selected model could not answer right now. Try again later or choose another model in Model settings.", modelSettingsNeeded: true },
  CHAT_UNAVAILABLE: { status: 503, message: "I could not prepare this chat right now. Please try your question again." },
  CHAT_SAVE_UNAVAILABLE: { status: 503, message: "Your answer arrived, but I could not confirm it was saved. Keep this chat open before trying again." },
  MODEL_SETTINGS_UNAVAILABLE: { status: 503, message: "I could not update or load your model settings right now. Please try again." },
} satisfies Record<string, { status: number; message: string; modelSettingsNeeded?: boolean }>;

export type PublicFailureCode = keyof typeof PUBLIC_FAILURES;

export const FRIENDLY_SERVER_ERROR = PUBLIC_FAILURES.REQUEST_UNAVAILABLE.message;

export function publicFailure(code: unknown, fallback: PublicFailureCode = "REQUEST_UNAVAILABLE") {
  const safeCode = typeof code === "string" && Object.hasOwn(PUBLIC_FAILURES, code)
    ? code as PublicFailureCode : fallback;
  const failure = PUBLIC_FAILURES[safeCode];
  return {
    code: safeCode,
    error: failure.message,
    status: failure.status,
    modelSettingsNeeded: "modelSettingsNeeded" in failure && failure.modelSettingsNeeded,
  };
}

export function failureFromError(error: unknown, fallback: PublicFailureCode) {
  return publicFailure(error instanceof Error && "code" in error ? error.code : undefined, fallback);
}

export function apiErrorMessage(body: unknown, status: number, fallback: PublicFailureCode = "REQUEST_UNAVAILABLE"): string {
  if (status === 401) return "Please sign in and try again.";
  if (body && typeof body === "object") {
    if ("code" in body && typeof body.code === "string" && Object.hasOwn(PUBLIC_FAILURES, body.code)) {
      return publicFailure(body.code).error;
    }
    // Validation messages are authored by our routes. Server failures require an allowlisted code.
    if (status < 500 && "error" in body && typeof body.error === "string" && body.error.trim()) {
      return body.error;
    }
  }
  return publicFailure(fallback).error;
}

export async function readApiError(response: Response, fallback: PublicFailureCode = "REQUEST_UNAVAILABLE"): Promise<string> {
  let body: unknown;
  if (response.headers.get("content-type")?.includes("application/json")) {
    body = await response.json().catch(() => undefined);
  }
  return apiErrorMessage(body, response.status, fallback);
}
