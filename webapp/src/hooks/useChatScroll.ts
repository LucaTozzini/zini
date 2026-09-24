import { useLayoutEffect, useRef, useState } from "react";

type ChatScrollOptions = {
  // Changes whenever the conversation does (e.g. the cached thread object).
  content: unknown;
  // The user's message is on its way: always scroll down to show it.
  sending: boolean;
  // Something is shown below the messages: the loading bubble or an error.
  busy: boolean;
  error: boolean;
  // The newest message is the agent's reply, so scroll to its start.
  lastIsReply: boolean;
};

// Auto-scroll for a chat. Follows new content only if the user was already at
// the bottom, so reading older messages isn't interrupted. A new reply is shown
// from its start, so a long one can be read top-down. Put scrollRef, onScroll
// and onScrollEnd on the scroll container, lastMessageRef on the last message, and
// data-chat-message on every message so the ones below the view can be counted.
export function useChatScroll({ content, sending, busy, error, lastIsReply }: ChatScrollOptions) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement>(null);
  // Starts true so a chat opens at its end.
  const atBottom = useRef(true);
  // While a smooth auto-scroll is moving, its own scroll events would make it
  // look like the user left the bottom, so position is only read once it ends.
  const autoScrolling = useRef(false);
  const hasScrolled = useRef(false);
  // null at the bottom; otherwise how many messages start below the visible area.
  const [messagesBelow, setMessagesBelow] = useState<number | null>(null);

  // Only re-renders when the answer changes, not on every scroll event.
  function measure() {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottom.current) return setMessagesBelow(null);
    const viewBottom = el.getBoundingClientRect().bottom;
    const below = [...el.querySelectorAll("[data-chat-message]")].filter(
      (message) => message.getBoundingClientRect().top > viewBottom,
    ).length;
    setMessagesBelow(below);
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el || autoScrolling.current) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    measure();
  }

  function onScrollEnd() {
    autoScrolling.current = false;
    onScroll();
  }

  // Smooth, except the first scroll when a chat opens, which jumps straight there.
  function scrollTo(top: number) {
    const el = scrollRef.current!;
    const behavior = hasScrolled.current ? "smooth" : "instant";
    hasScrolled.current = true;
    // Clamp to where the browser can actually scroll: a scroll that doesn't move
    // never fires scrollend, which would leave autoScrolling stuck on.
    top = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
    if (Math.abs(el.scrollTop - top) < 1) return;
    autoScrolling.current = behavior === "smooth";
    el.scrollTo({ top, behavior });
    // Fallback in case scrollend never fires (e.g. browsers without it).
    if (autoScrolling.current) setTimeout(onScrollEnd, 1000);
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const last = lastMessageRef.current;
    if (sending) {
      atBottom.current = true;
      scrollTo(el.scrollHeight);
    } else if (atBottom.current) {
      if (last && !busy && !error && lastIsReply) {
        scrollTo(el.scrollTop + last.getBoundingClientRect().top - el.getBoundingClientRect().top - 16);
      } else {
        scrollTo(el.scrollHeight);
      }
    }
    // A smooth scroll measures once it ends; otherwise count now, e.g. a reply
    // that arrived below while the user was reading further up.
    if (!autoScrolling.current) measure();
  }, [content, sending, busy, error, lastIsReply]);

  function scrollToBottom() {
    atBottom.current = true;
    scrollTo(scrollRef.current!.scrollHeight);
    if (!autoScrolling.current) measure();
  }

  return { scrollRef, lastMessageRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom };
}
