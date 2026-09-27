import * as chat from "../../convex/chat";
import * as episodes from "../../convex/episodes";
import * as llm from "../../convex/llm";
import * as profiles from "../../convex/profiles";
import * as transcript from "../../convex/transcript";
import * as transcriptChunks from "../../convex/transcriptChunks";
import * as users from "../../convex/users";
import * as apiModule from "../../convex/_generated/api";

/**
 * Explicit module map for `convex-test`.
 *
 * convex-test normally discovers functions with `import.meta.glob`, a Vite
 * build-time feature. Passing the map directly keeps these tests free of build
 * magic and makes the surface explicit — adding a new Convex module means
 * adding it here, which is the point: a forgotten module fails loudly instead
 * of silently vanishing from the suite.
 *
 * Keys are absolute paths and must include a `_generated` entry, because
 * convex-test derives the module root from it.
 */
const ROOT = new URL("../../convex/", import.meta.url).pathname;

export const convexModules = {
  [`${ROOT}_generated/api.js`]: () => Promise.resolve(apiModule),
  [`${ROOT}chat.ts`]: () => Promise.resolve(chat),
  [`${ROOT}episodes.ts`]: () => Promise.resolve(episodes),
  [`${ROOT}llm.ts`]: () => Promise.resolve(llm),
  [`${ROOT}profiles.ts`]: () => Promise.resolve(profiles),
  [`${ROOT}transcript.ts`]: () => Promise.resolve(transcript),
  [`${ROOT}transcriptChunks.ts`]: () => Promise.resolve(transcriptChunks),
  [`${ROOT}users.ts`]: () => Promise.resolve(users),
};
