import nextEnv from "@next/env";
import { fileURLToPath } from "node:url";

const { loadEnvConfig } = nextEnv;

export function validateLocalSetup(env) {
  const errors = [];
  const publishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
  const encodedHost = publishableKey.match(/^pk_test_(.+)$/)?.[1];
  let decodedHost = "";
  if (encodedHost) {
    decodedHost = Buffer.from(encodedHost, "base64").toString("utf8");
  }
  if (!decodedHost.endsWith("$") || !decodedHost.slice(0, -1).includes(".")) {
    errors.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a real Clerk publishable key.");
  }

  const secretKey = env.CLERK_SECRET_KEY ?? "";
  if (!secretKey.startsWith("sk_test_") || secretKey.length < 32 || secretKey.includes("your-key")) {
    errors.push("CLERK_SECRET_KEY must be a real Clerk secret key.");
  }

  const convexUrl = env.NEXT_PUBLIC_CONVEX_URL ?? "";
  try {
    const parsed = new URL(convexUrl);
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.hostname.includes("your-deployment")) {
      throw new Error("Invalid Convex URL");
    }
  } catch {
    errors.push("NEXT_PUBLIC_CONVEX_URL must be a real Convex deployment URL.");
  }
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnvConfig(process.cwd());
  const errors = validateLocalSetup(process.env);
  if (errors.length > 0) {
    console.error("Local setup is incomplete:");
    for (const error of errors) console.error(`- ${error}`);
    console.error("Use development keys from Clerk and a Convex development deployment. See README.md.");
    process.exitCode = 1;
  }
}
