import { useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  IconButton,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
} from "@mui/material";
import type { PipelineResume } from "shared";
import { errorMessage } from "../api/client.ts";
import { useCoordinator, useResumePipeline, useStartPipeline } from "../api/coordinator.ts";
import { useWorkspaceDiff } from "../api/workspaces.ts";
import RunLogs from "./coordinator-logs/RunLogs.tsx";
import BrowserView from "./pipeline/BrowserView.tsx";
import CommitCard from "./pipeline/CommitCard.tsx";
import PipelineTimeline from "./pipeline/PipelineTimeline.tsx";
import PullRequestCard from "./pipeline/PullRequestCard.tsx";

// The issue's pipeline. Only rendered while the dialog is open, so it's fetched then.
function CoordinatorPipeline({ issueId }: { issueId: string }) {
  const pipeline = useCoordinator(issueId);
  const diff = useWorkspaceDiff(issueId, Boolean(pipeline.data?.planApproved));
  const start = useStartPipeline(issueId);
  const resume = useResumePipeline(issueId);
  const reply = (r: PipelineResume) => resume.mutate(r);

  if (pipeline.isPending) return <Skeleton height={120} />;
  if (pipeline.isError) return <Alert severity="error">{errorMessage(pipeline.error)}</Alert>;

  const failure = start.error ?? resume.error;
  return (
    <Stack spacing={2}>
      {/* A run that failed (e.g. the model errored), or a request that did. */}
      {pipeline.data.error && <Alert severity="error">{pipeline.data.error}</Alert>}
      {failure && <Alert severity="error">{errorMessage(failure)}</Alert>}
      <PipelineTimeline
        pipeline={pipeline.data}
        diff={diff.data}
        actions={{
          onStart: (note) => start.mutate(note),
          onAnswer: (answers) => reply({ answers }),
          onApprovePlan: () => reply({ approve: true }),
          onPlanFeedback: (feedback) => reply({ feedback }),
          onImplementationFeedback: (feedback) => reply({ feedback }),
          onCommandsDecision: (decision) => {
            const { waiting } = pipeline.data;
            if (waiting?.kind === "approve_commands") {
              reply({ decisions: waiting.commands.map(() => decision) });
            }
          },
          sending: start.isPending || resume.isPending,
        }}
        browser={
          pipeline.data.browserUrl && (
            <BrowserView issueId={issueId} url={pipeline.data.browserUrl} />
          )
        }
        ship={
          <>
            <CommitCard issueId={issueId} />
            <PullRequestCard issueId={issueId} />
          </>
        }
      />
    </Stack>
  );
}

// The issue's subagent runs and their logs, for seeing what they did (or are doing).
function CoordinatorLogs({ issueId }: { issueId: string }) {
  const pipeline = useCoordinator(issueId);
  return <RunLogs issueId={issueId} pipelineRunning={Boolean(pipeline.data?.running)} />;
}

// The coordinator for one issue's workspace, in two tabs: its pipeline as a timeline
// of the subagents' documents (Summary), and each subagent run's log (Logs).
function CoordinatorDialog({
  issueId,
  open,
  onClose,
}: {
  issueId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"summary" | "logs">("summary");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-label="Coordinator"
      // The page's background, like the product manager chat. No backgroundImage: in
      // dark mode MUI lightens raised surfaces with an overlay image.
      slotProps={{
        paper: {
          sx: { bgcolor: "background.default", backgroundImage: "none" },
        },
      }}
    >
      <DialogContent
        sx={{
          height: "80vh",
          pt: 0,
          scrollbarGutter: 'stable',
        }}
      >
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            bgcolor: "background.default",
            zIndex: 100,
            pt: 2,
            mb: 2,
            borderBottomColor: "divider",
            borderBottomStyle: "solid",
            borderBottomWidth: 1,
          }}
        >
          <Tabs value={tab} onChange={(_e, value: "summary" | "logs") => setTab(value)}>
            <Tab value="summary" label="Summary" />
            <Tab value="logs" label="Logs" />
          </Tabs>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {tab === "summary" ? (
          <CoordinatorPipeline issueId={issueId} />
        ) : (
          <CoordinatorLogs issueId={issueId} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default CoordinatorDialog;
