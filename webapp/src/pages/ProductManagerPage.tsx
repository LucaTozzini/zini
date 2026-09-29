import { Box, Drawer, Paper, useMediaQuery, useTheme } from "@mui/material";
import { useLocation, useNavigate, useParams } from "react-router";
import { useDeleteThread, useThreads } from "../api.ts";
import Chat from "../components/Chat.tsx";
import ThreadList from "../components/ThreadList.tsx";
import { useChat, type CreatedChatState } from "../hooks/useChat.ts";
import { useEffect, useState } from "react";

const BASE_PATH = "/product-manager";

// Keyed in the page (see chatKey), so switching chats starts with a fresh draft,
// request and scroll state.
function ProductManagerChat({
  threadId,
  showChatlistButton,
  onChatlistButtonClick,
}: {
  threadId?: string;
  showChatlistButton: boolean;
  onChatlistButtonClick: () => void;
}) {
  const chat = useChat(threadId, BASE_PATH);
  return (
    <Chat
      showChatlistButton={showChatlistButton}
      onChatlistButtonClick={onChatlistButtonClick}
      chat={chat}
      avatar={{
        src: "/pm-avatar.jpg",
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

  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));
  const [chatsDrawer, setChatsDrawer] = useState(false);

  useEffect(() => {
    setChatsDrawer(false);
  }, [location, isSmallScreen]);

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
      {!isSmallScreen && (
        <ThreadList
          threads={threads.data}
          error={threads.error}
          activeId={threadId}
          basePath={BASE_PATH}
          onDelete={handleDelete}
        />
      )}
      <Drawer open={chatsDrawer} onClose={() => setChatsDrawer(false)}>
        <Paper sx={{ height: "100%" }}>
          <ThreadList
            threads={threads.data}
            error={threads.error}
            activeId={threadId}
            basePath={BASE_PATH}
            onDelete={handleDelete}
          />
        </Paper>
      </Drawer>
      <ProductManagerChat
        key={chatKey}
        threadId={threadId}
        showChatlistButton={isSmallScreen}
        onChatlistButtonClick={() => setChatsDrawer(true)}
      />
    </Box>
  );
};

export default ProductManagerPage;
