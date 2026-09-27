"use client";

import { FRIENDLY_SERVER_ERROR } from "@/lib/api-error";

export default function GlobalError({ reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: "36rem", margin: "5rem auto", padding: "1.5rem", fontFamily: "sans-serif" }}>
          <h1>That did not work</h1>
          <p>{FRIENDLY_SERVER_ERROR}</p>
          <button type="button" onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
