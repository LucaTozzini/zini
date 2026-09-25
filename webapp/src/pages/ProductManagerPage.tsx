import { Box } from "@mui/material";
import { useLocation, useNavigate, useParams } from "react-router";
import { useDeleteThread, useThreads } from "../api.ts";
import Chat from "../components/Chat.tsx";
import ThreadList from "../components/ThreadList.tsx";
import { useChat, type CreatedChatState } from "../hooks/useChat.ts";

const BASE_PATH = "/product-manager";

// Keyed in the page (see chatKey), so switching chats starts with a fresh draft,
// request and scroll state.
function ProductManagerChat({ threadId }: { threadId?: string }) {
  const chat = useChat(threadId, BASE_PATH);
  return (
    <Chat
      chat={chat}
      avatar={{
        src: "/pm-avatar.webp",
        label: "Product Manager",
      }}
      emptyText="Talk through an idea or a bug, and I'll help turn it into Linear issues"
      placeholder="Message the product manager"
    />
  );
}

const ProductManagerPage = () => {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // A chat per thread, and a fresh one each time a new chat is opened. A new chat
  // keeps its key once its first message creates it, so the view carries on rather
  // than remounting mid-reply.
  const created = location.state as CreatedChatState | null;
  const chatKey = created?.chatKey ?? threadId ?? location.key;
  const threads = useThreads();
  const deleteThread = useDeleteThread();

  // Leave a chat that was just deleted while open.
  function handleDelete(id: string) {
    deleteThread.mutate(id, {
      onSuccess: () => {
        if (id === threadId) navigate(BASE_PATH);
      },
    });
  }

  return (
    <Box
      sx={{
        display: "flex",
        height: "100%",
        overflowY: "hidden",
      }}
    >
      <ThreadList
        threads={threads.data}
        error={threads.error}
        activeId={threadId}
        basePath={BASE_PATH}
        onDelete={handleDelete}
      />
      <ProductManagerChat key={chatKey} threadId={threadId} />
    </Box>
  );
};

export default ProductManagerPage;
