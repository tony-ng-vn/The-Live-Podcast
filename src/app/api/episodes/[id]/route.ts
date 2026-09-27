import { api } from "@/lib/convex/client";
import { requireAuthedContext, toErrorResponse } from "@/lib/convex/require-auth";
import { asConvexId } from "@/lib/convex/ids";

export async function GET(
  _request: Request,
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

  try {
    // The userId is derived from the verified session inside the Convex
    // function, so a caller cannot read another user's episode by passing
    // their id as an argument.
    const episode = await convex.query(api.episodes.getEpisodeDetail, {
      episodeId: asConvexId<"episodes">(id),
    });

    if (!episode) {
      return Response.json({ error: "Episode not found" }, { status: 404 });
    }

    return Response.json(episode, { status: 200 });
  } catch (error) {
    return toErrorResponse(error, "Episode not found");
  }
}
