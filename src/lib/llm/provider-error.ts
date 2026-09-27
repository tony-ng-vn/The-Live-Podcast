import type { PublicFailureCode } from "../api-error";

export function modelProviderError(
  provider: string,
  status: number,
  detail: unknown,
  apiKey: string,
  statusText = "",
): Error & { code: PublicFailureCode } {
  const data = detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
  const quotaExhausted = data.code === "insufficient_quota" || data.type === "insufficient_quota";
  let code: PublicFailureCode = "MODEL_UNAVAILABLE";
  if (status === 401 || status === 403) code = "MODEL_KEY_INVALID";
  else if (status === 402 || quotaExhausted) code = "MODEL_CREDITS_REQUIRED";
  else if (status === 429) code = "MODEL_RATE_LIMITED";

  const rawMessage = typeof data.message === "string" ? data.message : "Request failed";
  const message = apiKey ? rawMessage.replaceAll(apiKey, "[REDACTED]") : rawMessage;
  return Object.assign(new Error(`${provider} API error: ${status}${statusText ? ` ${statusText}` : ""} - ${message}`), { code });
}
