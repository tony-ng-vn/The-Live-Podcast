import { api } from "@/lib/convex/client";
import {
  requireAuthedContext,
  statusForConvexError,
  toErrorResponse,
} from "@/lib/convex/require-auth";
import { asConvexId } from "@/lib/convex/ids";

interface BuildRequestBody {
  podcasterId?: string;
}

export async function POST(request: Request): Promise<Response> {
  let convex;
  try {
    ({ convex } = await requireAuthedContext());
  } catch (error) {
    return toErrorResponse(error, "Authentication failed");
  }

  let body: BuildRequestBody;
  try {
    body = (await request.json()) as BuildRequestBody;
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { podcasterId } = body;
  if (
    !podcasterId ||
    typeof podcasterId !== "string" ||
    podcasterId.trim() === ""
  ) {
    return Response.json(
      { error: "Missing or empty 'podcasterId' field" },
      { status: 400 },
    );
  }

  const typedPodcasterId = asConvexId<"podcasters">(podcasterId);

  try {
    const podcaster = await convex.query(api.profiles.getPodcasterById, {
      podcasterId: typedPodcasterId,
    });

    if (!podcaster) {
      return Response.json({ error: "Podcaster not found" }, { status: 404 });
    }

    // The Convex action re-checks that the caller owns an episode for this
    // podcaster before spending an LLM call.
    const result = await convex.action(api.profiles.rebuildPodcasterProfile, {
      podcasterId: typedPodcasterId,
    });

    if (!result.profile) {
      return Response.json(
        {
          profile: null,
          message: "No profile data available (no episodes found)",
        },
        { status: 200 },
      );
    }

    return Response.json(
      {
        profile: {
          podcasterId,
          summaryText: result.profile.summaryText,
          topics: result.profile.topics,
          personalityTraits: result.profile.personalityTraits,
          speakingStyle: result.profile.speakingStyle,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not build profile";
    const status = statusForConvexError(message);
    return Response.json({ error: message }, {
      status: status === 400 ? 503 : status,
    });
  }
}
