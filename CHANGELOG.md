## v0.5.1

2026-09-27

**Episodes**

- Videos with captions that only provide start times can now be added, with each cue held until the next cue and the final cue held until the video finishes.

**Models**

- Model limits, invalid keys, unavailable credits, and interrupted answers now explain how to recover in Model settings.
- Failed model requests no longer leave a pending question in saved history when it is still the latest question.

**Diagnostics**

- Errors now describe the failed step in plain language while keeping technical details in the private log.

---

## v0.5.0

2026-09-27

**Memory**

- You can review a private preview of your saved production chats and import one chosen chat into Fuzzy Brain as source evidence, with its video pause points and a verified receipt.

---

## v0.4.5

2026-09-27

**Episodes**

- Adding a video that is already in your library now gives a clear message without fetching its captions again.

---

## v0.4.4

2026-09-27

**Security**

- The database now checks each person's Clerk identity before reading or changing their videos and conversations, including requests made directly to Convex.
- The unused profile building endpoint is no longer callable, so it cannot mix transcript material from different users.

---

## v0.4.3

2026-09-27

**Security**

- The production database no longer exposes a command that could erase all saved videos and conversations.

---

## v0.4.2

2026-09-27

**Diagnostics**

- Production errors now keep a private, redacted record in Convex with the error ID shown to the viewer.

---

## v0.4.1

2026-09-27

**Episodes**

- Chat now leaves out answers from later pause points after a rewind and rejects conversation IDs from another video.

---

## v0.4.0

2026-09-27

**Models**

- People can save encrypted OpenRouter and OpenAI keys, choose their own model, and remove a saved key from Model settings.
- Video chat uses each person's saved model and key and points them to Model settings when a key is missing.

**Branding**

- The app now uses The Live Podcast in navigation, page titles, video import copy, and package metadata.

---

## v0.3.4

2026-09-27

**Episodes**

- Hosted video imports now fetch timed captions through SerpApi, while local imports continue using the Python transcript service.
- The transcript service requires a shared token so only the app can request captions from it.

---

## v0.3.3

2026-09-27

**Episodes**

- Chat now reads captions only after they finish before the pause point, so a question does not reveal later speech from the same transcript chunk.

---

## v0.3.2

2026-09-27

**Dependencies**

- Update Next.js, Clerk, and Convex to compatible current releases for the production launch.
- Resolve the remaining npm audit findings in the dependency lockfile.

---

## v0.3.1

2026-09-27

**Authentication**

- Sign-in and sign-up now continue through Clerk's verification steps without a route error.
