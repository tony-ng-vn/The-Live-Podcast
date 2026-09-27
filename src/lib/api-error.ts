export const FRIENDLY_SERVER_ERROR =
  "Oops, someone stole the apple. Please try again while I find another one.";

export async function readApiError(response: Response): Promise<string> {
  if (response.status === 401) return "Please sign in and try again.";
  if (response.status >= 500) return FRIENDLY_SERVER_ERROR;

  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {}
  }

  return FRIENDLY_SERVER_ERROR;
}
