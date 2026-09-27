import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  const source = `${context.routeType}:${context.routePath}`;
  if (process.env.NEXT_RUNTIME === "edge") {
    console.error("[app-error]", JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
    return;
  }

  const { recordServerError } = await import("@/lib/server-error");
  await recordServerError(source, error);
};
