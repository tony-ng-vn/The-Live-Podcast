import { api } from "@/lib/convex/client";
import { requireAuthedContext, toErrorResponse } from "@/lib/convex/require-auth";
import { asConvexId } from "@/lib/convex/ids";

/**
 * Paged transcript for the watch page.
 *
 * Kept server-side so the Convex session token never reaches the browser, and
 * paged so a long episode is not downloaded in full. The watch page only needs
 * four episode fields, so the transcript is fetched here on demand.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  let convex;
  try {
    ({ convex } = await requireAuthedContext());
  } catch (error) {
    return toErrorResponse(error, "Authentication failed");
  }

  const { id } = await params;
  if (!id || id.trim() === "") {
    return Response.json({ error: "Episode not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const rawNum = url.searchParams.get("num");
  const rawCursor = url.searchParams.get("cursor");

  const numItems = rawNum ? Number.parseInt(rawNum, 10) : 200;
  if (!Number.isFinite(numItems) || numItems < 1) {
    return Response.json(
      { error: "'num' must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    const result = await convex.query(api.transcriptChunks.listChunksPaged, {
      episodeId: asConvexId<"episodes">(id),
      pagination: {
        numItems,
        endCursor: rawCursor && rawCursor !== "null" ? rawCursor : null,
      },
    });

    return Response.json(result, {
      status: 200,
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    return toErrorResponse(error, "Failed to load transcript");
  }
}
