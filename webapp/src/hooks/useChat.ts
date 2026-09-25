import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Decision } from "shared";
import { useCreateThread, useResumeThread, useSendMessage, useThread } from "../api.ts";

// Navigation state when a new chat's first message creates it: the page keeps the
// same chat view (see ProductManagerPage), so nothing on screen restarts.
export type CreatedChatState = { chatKey: string };

// Everything one chat needs: its messages, the draft, and sending or approving.
// A new chat when threadId is undefined; its first message creates the thread and
// moves to basePath/<id>. The agent works in the background: the chat shows it as
// running, and useThreadEvents keeps it refetched until the reply is in.
export function useChat(threadId: string | undefined, basePath: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const thread = useThread(threadId);
  const create = useCreateThread();
  const send = useSendMessage(threadId ?? "");
  const resume = useResumeThread(threadId ?? "");
  const [draft, setDraft] = useState("");

  const messages = thread.data?.messages ?? [];
  const pending = thread.data?.pending ?? [];
  // A new chat's first message has no chat to live in until the page moves to the
  // created one, so it's shown from the request meanwhile.
  const creating = !threadId && (create.isPending || create.isSuccess);
  // "Thinking" follows the chat's running, which sending sets together with adding the
  // message, so the two appear at once.
  const busy = creating || Boolean(thread.data?.running);
  const posting = send.isPending || resume.isPending;
  const canSend = pending.length === 0 && !busy && !posting && draft.trim().length > 0;
  const runError = thread.data?.error ? new Error(thread.data.error) : null;
  const error = thread.error ?? create.error ?? send.error ?? resume.error ?? runError;

  function sendDraft(e?: FormEvent) {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || !canSend) return;

    // If sending fails, the message goes back in the input.
    setDraft("");
    const restore = () => setDraft(message);
    if (threadId) {
      send.mutate(message, { onError: restore });
    } else {
      create.mutate(message, {
        onSuccess: ({ id }) => {
          const state: CreatedChatState = { chatKey: location.key };
          navigate(`${basePath}/${id}`, { state });
        },
        onError: restore,
      });
    }
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
    sending: creating ? create.variables : null,
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
