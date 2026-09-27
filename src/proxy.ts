import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedPageRoute = createRouteMatcher(["/library(.*)", "/watch(.*)", "/settings(.*)"]);
const isProtectedApiRoute = createRouteMatcher([
  "/api/chat(.*)",
  "/api/chat/end(.*)",
  "/api/episodes(.*)",
  "/api/profiles/build(.*)",
  "/api/model-settings(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (isProtectedApiRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (isProtectedPageRoute(request)) {
    await auth.protect();
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/library/:path*",
    "/watch/:path*",
    "/api/chat/:path*",
    "/api/chat/end/:path*",
    "/api/episodes/:path*",
    "/api/profiles/build/:path*",
    "/settings/:path*",
    "/api/model-settings/:path*",
  ],
};
