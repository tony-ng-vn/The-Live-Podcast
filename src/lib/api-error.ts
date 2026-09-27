export async function readApiError(response: Response): Promise<string> {
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        return body.error;
      }
    } catch {
      // A broken JSON response should still give the user an actionable error.
    }
  }

  return `The server returned HTTP ${response.status}. Check the terminal running npm run dev.`;
}
