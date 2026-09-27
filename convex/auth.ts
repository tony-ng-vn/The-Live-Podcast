import { ConvexError } from "convex/values";

interface AuthContext {
  getUserIdentity(): Promise<{ subject: string } | null>;
}

export async function requireClerkUser(auth: AuthContext, expectedUserId?: string): Promise<string> {
  const identity = await auth.getUserIdentity();
  if (!identity || (expectedUserId && identity.subject !== expectedUserId)) {
    throw new ConvexError("Unauthorized");
  }
  return identity.subject;
}

export function requireRecordOwner(ownerUserId: string | undefined, authenticatedUserId: string): void {
  if (ownerUserId !== authenticatedUserId) {
    throw new ConvexError("Unauthorized");
  }
}
