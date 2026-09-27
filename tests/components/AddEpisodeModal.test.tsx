/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

import AddEpisodeModal from "@/components/AddEpisodeModal";

function stubFetch(status: number, body: unknown = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function submit(url: string) {
  const user = userEvent.setup();
  const input = screen.getByLabelText(/youtube podcast url/i);
  await user.clear(input);
  await user.type(input, url);
  await user.click(screen.getByRole("button", { name: /^add episode$/i }));
}

describe("AddEpisodeModal", () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AddEpisodeModal open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("rejects an empty submission without calling the API", async () => {
    const fetchMock = stubFetch(201);
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /^add episode$/i }));

    expect(await screen.findByText(/please enter a url/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * The client used to keep its own stricter URL check, which rejected links
   * the server accepts. These are all valid per the shared extractor.
   */
  it.each([
    "https://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "dQw4w9WgXcQ",
  ])("accepts %s", async (url) => {
    const fetchMock = stubFetch(201, { id: "ep1" });
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    await submit(url);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/episodes",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it.each([
    "https://vimeo.com/12345",
    "https://example.com/watch?v=abc",
    "not a url at all",
    "https://www.evil-www.youtube.com.evil.com/watch?v=x",
  ])("rejects %s", async (url) => {
    const fetchMock = stubFetch(201);
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    await submit(url);

    expect(
      await screen.findByText(/does not look like a youtube video link/i),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes to the library on success", async () => {
    stubFetch(201, { id: "ep1" });
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    await submit("https://youtu.be/dQw4w9WgXcQ");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/library");
    });
  });

  it("routes to the library when the episode already exists", async () => {
    stubFetch(409, { error: "Episode with this YouTube video has already been ingested" });
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    await submit("https://youtu.be/dQw4w9WgXcQ");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/library");
    });
  });

  it("shows the server error and stays open on failure", async () => {
    stubFetch(422, { error: "No transcript found for this video." });
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    await submit("https://youtu.be/dQw4w9WgXcQ");

    expect(
      await screen.findByText(/no transcript found for this video/i),
    ).toBeTruthy();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<AddEpisodeModal open onClose={onClose} />);

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("is announced as a modal dialog", () => {
    render(<AddEpisodeModal open onClose={vi.fn()} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toMatch(/add a podcast episode/i);
  });
});
