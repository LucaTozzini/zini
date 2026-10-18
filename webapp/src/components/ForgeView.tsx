import { useMemo, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Container,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import type { ForgeResume, ForgeState } from "shared";
import { errorMessage } from "../api/client.ts";
import { useForge, useMessageForge, useForgeControl, useResumeForge, useStartForge } from "../api/forge.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import CheckpointActivity from "./forge/CheckpointActivity.tsx";
import ChatInput from "./chat/ChatInput.tsx";
import BrowserView from "./forge/BrowserView.tsx";
import ForgeRequest from "./forge/ForgeRequest.tsx";
import PullRequestCard from "./forge/PullRequestCard.tsx";

function ForgeContent({ issueId, forge }: { issueId: string; forge: ForgeState }) {
  const start = useStartForge(issueId);
  const resume = useResumeForge(issueId);
  const message = useMessageForge(issueId);
  const control = useForgeControl(issueId);
  const reply = (response: ForgeResume) => resume.mutate(response);
  const sending = start.isPending || resume.isPending || message.isPending;
  const failure = start.error ?? resume.error ?? message.error ?? control.error;
  const [activityContent, setActivityContent] = useState("");
  const content = useMemo(() => ({ forge, activityContent }), [forge, activityContent]);
  const { scrollRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content,
    sending,
    busy: Boolean(forge.running),
    error: Boolean(failure || forge.error),
    lastIsReply: false,
  });
  // Paused or interrupted work can be resumed; running work is paused from the input.
  const resumable = Boolean(forge.pausing || (forge.canResume && !forge.running));
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  // The Lead takes messages when it isn't working or waiting on a reply.
  const canMessage = forge.started && !forge.running && !forge.pausing && !forge.waiting;
  const canSend = canMessage && !sending && Boolean(draft.trim() || images.length);
  const send = () => {
    if (!canSend) return;
    message.mutate(
      { message: draft.trim(), images },
      {
        onSuccess: () => {
          setDraft("");
          setImages([]);
        },
      },
    );
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <Box
        ref={scrollRef}
        onScroll={onScroll}
        onScrollEnd={onScrollEnd}
        aria-label="Forge conversation"
        sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        <Container maxWidth={false} sx={{ maxWidth: 750, pt: 3, pb: 18 }}>
          <Stack spacing={3}>
            {forge.started && <CheckpointActivity issueId={issueId} forge={forge} onContentChange={setActivityContent} />}
            {forge.error && <Alert severity="error">{forge.error}</Alert>}
            {forge.integration?.status === "conflicts" && (
              <Alert severity="warning">
                Resolving conflicts with {forge.integration.targetBranch}
                {forge.integration.conflicts.length > 0 && ` — ${forge.integration.conflicts.join(", ")}`}
              </Alert>
            )}
            {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
            {forge.finished && (
              <>
                <PullRequestCard issueId={issueId} />
              </>
            )}
            <Box data-chat-message="">
              <ForgeRequest
                issueId={issueId}
                forge={forge}
                onStart={(note) => start.mutate(note)}
                onReply={reply}
                sending={sending}
              />
            </Box>
            {forge.browserUrl && (
              <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>Live product preview</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <BrowserView issueId={issueId} url={forge.browserUrl} />
                </AccordionDetails>
              </Accordion>
            )}
          </Stack>
        </Container>
      </Box>
      {(forge.started || messagesBelow !== null) && (
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            pt: 4,
            pb: 2,
            pointerEvents: "none",
            background: (theme) => `linear-gradient(transparent, ${(theme.vars || theme).palette.background.default} 40%)`,
          }}
        >
          <Stack spacing={1} sx={{ alignItems: "center" }}>
            {messagesBelow !== null && (
              <Button
                variant="contained"
                size="small"
                startIcon={<KeyboardArrowDownIcon />}
                onClick={scrollToBottom}
                sx={{ pointerEvents: "auto" }}
              >
                Latest activity
              </Button>
            )}
            {resumable && (
              <Button
                variant="outlined"
                loading={control.isPending || forge.pausing}
                disabled={sending || forge.pausing}
                onClick={() => control.mutate("continue")}
                sx={{ pointerEvents: "auto", bgcolor: "background.default" }}
              >
                {forge.pausing ? "Pausing…" : "Resume"}
              </Button>
            )}
            {forge.started && (
              <Container maxWidth={false} sx={{ maxWidth: 750, pointerEvents: "auto" }}>
                <ChatInput
                  images={images}
                  onImagesChange={setImages}
                  value={draft}
                  onChange={setDraft}
                  loading={message.isPending}
                  disabled={Boolean(forge.waiting)}
                  canSend={canSend}
                  stoppable={Boolean(forge.running && !forge.pausing)}
                  onStop={() => control.mutate("pause")}
                  placeholder={
                    forge.waiting
                      ? "Reply to the Lead above first"
                      : forge.running
                        ? "Pause the Lead to message it"
                        : forge.finished
                          ? "Ask the Lead for changes"
                          : "Message the Lead"
                  }
                  handleKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onSubmit={send}
                />
              </Container>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function ForgeView({ issueId }: { issueId: string }) {
  const query = useForge(issueId);
  if (query.isPending) return <Skeleton height={120} />;
  if (query.isError) return <Alert severity="error">{errorMessage(query.error)}</Alert>;
  return <ForgeContent key={issueId} issueId={issueId} forge={query.data} />;
}

export default ForgeView;
