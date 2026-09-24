import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import type { Decision } from "shared";
import { useCreateThread, useResumeThread, useSendMessage, useThread } from "../api.ts";

// Everything one chat needs: its messages, the draft, and sending or approving.
// A new chat when threadId is undefined; its first message creates the thread and
// moves to basePath/<id>.
export function useChat(threadId: string | undefined, basePath: string) {
  const navigate = useNavigate();
  const thread = useThread(threadId);
  const create = useCreateThread();
  const send = useSendMessage(threadId ?? "");
  const resume = useResumeThread(threadId ?? "");
  const [draft, setDraft] = useState("");

  const messages = thread.data?.messages ?? [];
  const pending = thread.data?.pending ?? [];
  const busy = create.isPending || send.isPending || resume.isPending;
  const canSend = pending.length === 0 && !busy && draft.trim().length > 0;
  const error = thread.error ?? create.error ?? send.error ?? resume.error;
  // Shown until the agent answers, then it's part of the thread.
  const sending = create.isPending
    ? create.variables
    : send.isPending
      ? send.variables
      : null;

  function sendDraft(e?: FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || !canSend) return;

    setDraft("");
    if (threadId) send.mutate(message);
    else
      create.mutate(message, {
        onSuccess: ({ id }) => navigate(`${basePath}/${id}`),
      });
  }

  // Enter sends, Shift+Enter adds a new line.
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) sendDraft(e);
  }

  // Approve or reject applies to every pending action at once.
  function decide(decision: Decision) {
    resume.mutate(pending.map(() => decision));
  }

  return {
    thread,
    messages,
    pending,
    draft,
    setDraft,
    sending,
    busy,
    canSend,
    error,
    // Only the send button spins; approvals show their own loading state.
    sendLoading: create.isPending || send.isPending,
    decideLoading: resume.isPending,
    sendDraft,
    handleKeyDown,
    decide,
  };
}

export type ChatState = ReturnType<typeof useChat>;
