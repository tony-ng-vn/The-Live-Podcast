import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import GlobalError from "../../src/app/global-error";

describe("global error page", () => {
  it("shows a safe message and a retry button", () => {
    const markup = renderToStaticMarkup(
      <GlobalError error={new Error("Convex deployment disabled")} reset={vi.fn()} />,
    );

    expect(markup).toContain("That request did not finish.");
    expect(markup).toContain("Try again");
    expect(markup).not.toContain("Convex deployment disabled");
  });
});
