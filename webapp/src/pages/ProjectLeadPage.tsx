import { useLocation, useParams } from "react-router";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import { useThreads } from "../api/projectLead.ts";
import Chat from "../components/Chat.tsx";
import ProjectLeadBrowserButton from "../components/chat/ProjectLeadBrowserButton.tsx";
import ProjectLeadSubscriptionsButton from "../components/chat/ProjectLeadSubscriptionsButton.tsx";
import { useChat, type CreatedChatState } from "../hooks/useChat.ts";

const BASE_PATH = "/project-lead";

const SUGGESTIONS = [
  { label: "Plan a feature", message: "I'd like to plan a new feature: " },
  { label: "Report a bug", message: "I found a bug: " },
  { label: "Review the backlog", message: "Go through the backlog and suggest what to work on next." },
];

// Keyed in the page (see chatKey), so switching chats starts with a fresh draft,
// request and scroll state.
function ProjectLeadChat({ threadId }: { threadId?: string }) {
  const chat = useChat(threadId, BASE_PATH);
  const threads = useThreads();
  const title = (threadId && threads.data?.find((thread) => thread.id === threadId)?.title) || "New chat";
  return (
    <Chat
      chat={chat}
      headerActions={
        <>
          <ProjectLeadBrowserButton threadId={threadId} />
          <ProjectLeadSubscriptionsButton threadId={threadId} />
        </>
      }
      title={title}
      agent={{ name: "Project Lead", icon: <SupportAgentIcon /> }}
      emptyTitle="What are we working on?"
      emptyText="Talk through an idea or a bug, and I'll help turn it into Linear issues."
      suggestions={SUGGESTIONS}
      placeholder="Message the project lead"
    />
  );
}

const ProjectLeadPage = () => {
  const { threadId } = useParams();
  const location = useLocation();
  // A chat per thread, and a fresh one each time a new chat is opened. A new chat
  // keeps its key once its first message creates it, so the view carries on rather
  // than remounting mid-reply.
  const created = location.state as CreatedChatState | null;
  const chatKey = created?.chatKey ?? threadId ?? location.key;

  return <ProjectLeadChat key={chatKey} threadId={threadId} />;
};

export default ProjectLeadPage;
