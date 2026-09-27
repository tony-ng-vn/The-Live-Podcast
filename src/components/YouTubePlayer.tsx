"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

declare global {
  interface Window {
    YT: typeof YT;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

export interface YouTubePlayerHandle {
  play: () => void;
  pause: () => void;
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
  onTimeUpdate?: (handler: (seconds: number) => void) => () => void;
}

interface YouTubePlayerProps {
  videoId: string;
  /** Fired periodically with the current playback position. */
  onTimeUpdate?: (seconds: number) => void;
}

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";
/** YouTube fires onStateChange roughly every 250-1000ms while playing. */
const TIME_POLL_MS = 500;

const YouTubePlayer = forwardRef<YouTubePlayerHandle, YouTubePlayerProps>(
  function YouTubePlayer({ videoId, onTimeUpdate }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<YT.Player | null>(null);
    const [ready, setReady] = useState(false);

    // Read through a ref so the polling effect does not re-subscribe every time
    // the parent passes a new callback identity. Synced in an effect because
    // writing a ref during render is unsafe in React 19.
    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => {
      onTimeUpdateRef.current = onTimeUpdate;
    }, [onTimeUpdate]);

    const destroyPlayer = useCallback(() => {
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // The iframe may already be detached; nothing to clean up.
        }
        playerRef.current = null;
      }
    }, []);

    const initPlayer = useCallback(() => {
      if (!containerRef.current || playerRef.current) return;

      // `YT.Player` replaces the container element with an iframe and
      // `destroy()` does not put it back, so hand it a fresh child on every
      // (re)initialisation. Without this, a `videoId` change remounts the
      // player into a detached node and the page shows a black box.
      const host = document.createElement("div");
      host.className = "h-full w-full";
      containerRef.current.replaceChildren(host);

      playerRef.current = new window.YT.Player(host, {
        videoId,
        playerVars: {
          autoplay: 0,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: () => setReady(true),
        },
      });
    }, [videoId]);

    useEffect(() => {
      if (window.YT?.Player) {
        initPlayer();
      } else {
        const existingScript = document.querySelector(
          `script[src="${IFRAME_API_SRC}"]`,
        );
        if (!existingScript) {
          const script = document.createElement("script");
          script.src = IFRAME_API_SRC;
          script.async = true;
          document.head.appendChild(script);
        }

        const previous = window.onYouTubeIframeAPIReady;
        // Compare against the wrapper we assign, not `initPlayer` — the old
        // cleanup check compared the wrong reference and never restored it.
        const handler = () => {
          previous?.();
          initPlayer();
        };
        window.onYouTubeIframeAPIReady = handler;

        return () => {
          if (window.onYouTubeIframeAPIReady === handler) {
            window.onYouTubeIframeAPIReady = previous;
          }
        };
      }

      return undefined;
    }, [initPlayer]);

    // Tear the player down when the component goes away or the video changes.
    // Without this, navigating library -> watch -> library left live
    // YT.Player instances (and their iframes and listeners) behind.
    useEffect(() => {
      return () => {
        destroyPlayer();
        // Required on a `videoId` change: without it `ready` stays true from
        // the previous player, so play()/getCurrentTime() would be issued
        // against an unready instance and silently do nothing. React ignores
        // this when the component is unmounting.
        setReady(false);
      };
    }, [destroyPlayer, videoId]);

    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          if (ready && playerRef.current) playerRef.current.playVideo();
        },
        pause: () => {
          if (ready && playerRef.current) playerRef.current.pauseVideo();
        },
        getCurrentTime: () => {
          if (ready && playerRef.current) {
            return playerRef.current.getCurrentTime();
          }
          return 0;
        },
        seekTo: (seconds: number) => {
          if (ready && playerRef.current) {
            playerRef.current.seekTo(seconds, true);
          }
        },
        onTimeUpdate: (handler: (seconds: number) => void) => {
          const id = setInterval(() => {
            if (ready && playerRef.current) {
              handler(playerRef.current.getCurrentTime());
            }
          }, TIME_POLL_MS);
          return () => clearInterval(id);
        },
      }),
      [ready],
    );

    useEffect(() => {
      if (!ready || !onTimeUpdateRef.current) return;
      const id = setInterval(() => {
        if (playerRef.current) {
          onTimeUpdateRef.current?.(playerRef.current.getCurrentTime());
        }
      }, TIME_POLL_MS);
      return () => clearInterval(id);
    }, [ready]);

    return (
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
        <div ref={containerRef} className="h-full w-full" />
      </div>
    );
  },
);

export default YouTubePlayer;
