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
