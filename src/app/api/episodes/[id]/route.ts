import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  getConvexClient,
  api,
} from "@/lib/convex/client";
import { asConvexId } from "@/lib/convex/ids";
import { FRIENDLY_SERVER_ERROR } from "@/lib/api-error";
import { recordServerError } from "@/lib/server-error";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  let userId: string | null;
  try {
    ({ userId } = await auth());
  } catch (error) {
    const errorId = await recordServerError("episodes.auth", error);
    return NextResponse.json({ error: FRIENDLY_SERVER_ERROR, errorId }, { status: 503 });
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id || id.trim() === "") {
    return NextResponse.json(
      { error: "Episode not found" },
      { status: 404 }
    );
  }

  try {
    const convex = getConvexClient();
    const episode = await convex.query(api.episodes.getEpisodeDetail, {
      episodeId: asConvexId<"episodes">(id),
      userId,
    });

    if (!episode) {
      return NextResponse.json(
        { error: "Episode not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(episode, { status: 200 });
  } catch (error) {
    const errorId = await recordServerError("episodes.detail", error);
    return NextResponse.json(
      { error: FRIENDLY_SERVER_ERROR, errorId },
      { status: 503 }
    );
  }
}
