import { useLocation, useParams } from "react-router";
import Chat from "../components/Chat.tsx";
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
  const location = useLocation();
  // A chat per thread, and a fresh one each time a new chat is opened. A new chat
  // keeps its key once its first message creates it, so the view carries on rather
  // than remounting mid-reply.
  const created = location.state as CreatedChatState | null;
  const chatKey = created?.chatKey ?? threadId ?? location.key;

  return (
    <ProductManagerChat
      key={chatKey}
      threadId={threadId}
    />
  );
};

export default ProductManagerPage;
