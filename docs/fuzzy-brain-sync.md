# Sync saved chats to Fuzzy Brain

The Live Podcast has a local command that copies one of your saved production chats into Fuzzy Brain as source evidence.
It does not turn a chat into an approved memory or change what the video chat model can see.
The command only reads conversations that belong to the configured Clerk user.
It does not export video captions or other users' chats.

This first version runs on a computer with both repositories and their private credentials.
It is manual and does not run on Vercel.

## Private setup

Register a dedicated source in Fuzzy Brain with kind `live_podcast_conversation` and label `the-live-podcast`.
Set any person, thread, or topic exclusions on that source before importing chats.
Add its source UUID to Fuzzy Brain's private `TBRAIN_ALLOWED_SOURCE_IDS` list.

In The Live Podcast's private `.env.local`, set these values:

```text
FUZZY_BRAIN_OWNER_CLERK_USER_ID=<your production Clerk user ID>
FUZZY_BRAIN_SOURCE_ID=<the registered Fuzzy Brain source UUID>
FUZZY_BRAIN_REPO=<absolute path to the fuzzy-brain checkout>
FUZZY_BRAIN_SYNC_DIR=<absolute path to a private, durable state directory>
```

Keep the state directory outside a temporary worktree and restrict it to your local account.
It holds prepared chat text and verified receipt IDs.
The CLI creates files with owner-only permissions.
Do not commit the private settings, previews, or receipts.

The project also needs its normal Convex CLI configuration so `convex run --prod` can read the production deployment.
The command uses Convex's local admin CLI and then checks the configured owner against each conversation and video.
It never creates a public export endpoint.

## Preview and import

Run this from The Live Podcast checkout:

```bash
npm run sync:fuzzy-brain -- prepare
```

The command lists each changed chat's title, saved message count, private preview file, and exact import command.
Read the JSON preview before importing it.
The preview includes the saved chat text, video ID, and each message's video pause point.
It does not include video captions.
If no saved production chats exist, the command reports that and clears its previous preview list.

Import one reviewed chat with the ID printed by `prepare`:

```bash
npm run sync:fuzzy-brain -- import <chat-id>
```

Fuzzy Brain checks its source exclusions during import.
The command records a receipt only after Fuzzy Brain verifies the stored revision and every saved message.
It prints that receipt ID so you can read the imported source in Fuzzy Brain.
If the import result is uncertain, retry the same prepared chat ID before preparing a newer revision.
Fuzzy Brain replays an identical packet without adding a duplicate.

Run `prepare` again after a chat gains more messages.
The next revision links to the previous verified receipt.
The imported evidence remains unratified until you separately review and approve any memory drawn from it.
The current command does not delete evidence already imported into Fuzzy Brain.
