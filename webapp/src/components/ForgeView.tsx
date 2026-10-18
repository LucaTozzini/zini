import { useMemo, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Container, Skeleton, Stack, Typography } from "@mui/material";
import type { PipelineResume, PipelineState } from "shared";
import { errorMessage } from "../api/client.ts";
import { useForge, useMessagePipeline, usePipelineControl, useResumePipeline, useStartPipeline } from "../api/forge.ts";
import { useChatScroll } from "../hooks/useChatScroll.ts";
import CheckpointActivity from "./forge-activity/CheckpointActivity.tsx";
import ChatInput from "./chat/ChatInput.tsx";
import BrowserView from "./pipeline/BrowserView.tsx";
import PipelineRequest from "./pipeline/PipelineRequest.tsx";
import PullRequestCard from "./pipeline/PullRequestCard.tsx";

function ForgeContent({ issueId, pipeline }: { issueId: string; pipeline: PipelineState }) {
  const start = useStartPipeline(issueId);
  const resume = useResumePipeline(issueId);
  const message = useMessagePipeline(issueId);
  const control = usePipelineControl(issueId);
  const reply = (response: PipelineResume) => resume.mutate(response);
  const sending = start.isPending || resume.isPending || message.isPending;
  const failure = start.error ?? resume.error ?? message.error ?? control.error;
  const [activityContent, setActivityContent] = useState("");
  const content = useMemo(() => ({ pipeline, activityContent }), [pipeline, activityContent]);
  const { scrollRef, onScroll, onScrollEnd, messagesBelow, scrollToBottom } = useChatScroll({
    content, sending, busy: Boolean(pipeline.running),
    error: Boolean(failure || pipeline.error), lastIsReply: false,
  });
  // Paused or interrupted work can be resumed; running work is paused from the input.
  const resumable = Boolean(pipeline.pausing || (pipeline.canResume && !pipeline.running));
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<string[]>([]);
  // The Lead takes messages when it isn't working or waiting on a reply.
  const canMessage = pipeline.started && !pipeline.running && !pipeline.pausing && !pipeline.waiting;
  const canSend = canMessage && !sending && Boolean(draft.trim() || images.length);
  const send = () => {
    if (!canSend) return;
    message.mutate({ message: draft.trim(), images }, { onSuccess: () => { setDraft(""); setImages([]); } });
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <Box ref={scrollRef} onScroll={onScroll} onScrollEnd={onScrollEnd} aria-label="Forge conversation"
        sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Container maxWidth={false} sx={{ maxWidth: 750, pt: 3, pb: 18 }}>
      <Stack spacing={3}>
      {pipeline.started && <CheckpointActivity issueId={issueId} pipeline={pipeline} onContentChange={setActivityContent} />}
      {pipeline.error && <Alert severity="error">{pipeline.error}</Alert>}
      {pipeline.integration?.status === "conflicts" && <Alert severity="warning">
        Resolving conflicts with {pipeline.integration.targetBranch}
        {pipeline.integration.conflicts.length > 0 && ` — ${pipeline.integration.conflicts.join(", ")}`}
      </Alert>}
      {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
      {pipeline.finished && <>
        <PullRequestCard issueId={issueId} />
      </>}
      <Box data-chat-message="">
        <PipelineRequest issueId={issueId} pipeline={pipeline} onStart={(note) => start.mutate(note)} onReply={reply}
          sending={sending} />
      </Box>
      {pipeline.browserUrl && <Accordion slotProps={{ transition: { unmountOnExit: true } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>Live product preview</Typography></AccordionSummary>
        <AccordionDetails><BrowserView issueId={issueId} url={pipeline.browserUrl} /></AccordionDetails>
      </Accordion>}
      </Stack>
      </Container>
      </Box>
      {(pipeline.started || messagesBelow !== null) && <Box sx={{ position: "absolute", bottom: 0, left: 0, right: 0,
        pt: 4, pb: 2, pointerEvents: "none",
        background: (theme) => `linear-gradient(transparent, ${(theme.vars || theme).palette.background.default} 40%)` }}>
        <Stack spacing={1} sx={{ alignItems: "center" }}>
          {messagesBelow !== null && <Button variant="contained" size="small" startIcon={<KeyboardArrowDownIcon />}
            onClick={scrollToBottom} sx={{ pointerEvents: "auto" }}>Latest activity</Button>}
          {resumable && <Button variant="outlined" loading={control.isPending || pipeline.pausing}
            disabled={sending || pipeline.pausing}
            onClick={() => control.mutate("continue")}
            sx={{ pointerEvents: "auto", bgcolor: "background.default" }}>
            {pipeline.pausing ? "Pausing…" : "Resume"}
          </Button>}
          {pipeline.started && <Container maxWidth={false} sx={{ maxWidth: 750, pointerEvents: "auto" }}>
            <ChatInput
              images={images}
              onImagesChange={setImages}
              value={draft}
              onChange={setDraft}
              loading={message.isPending}
              disabled={Boolean(pipeline.waiting)}
              canSend={canSend}
              stoppable={Boolean(pipeline.running && !pipeline.pausing)}
              onStop={() => control.mutate("pause")}
              placeholder={pipeline.waiting ? "Reply to the Lead above first"
                : pipeline.running ? "Pause the Lead to message it"
                : pipeline.finished ? "Ask the Lead for changes" : "Message the Lead"}
              handleKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              onSubmit={send}
            />
          </Container>}
        </Stack>
      </Box>}
    </Box>
  );
}

function ForgeView({ issueId }: { issueId: string }) {
  const pipeline = useForge(issueId);
  if (pipeline.isPending) return <Skeleton height={120} />;
  if (pipeline.isError) return <Alert severity="error">{errorMessage(pipeline.error)}</Alert>;
  return <ForgeContent key={issueId} issueId={issueId} pipeline={pipeline.data} />;
}

export default ForgeView;
