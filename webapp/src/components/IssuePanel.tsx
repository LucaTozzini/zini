import { useState, type ReactNode } from "react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddIcon from "@mui/icons-material/Add";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import CloseIcon from "@mui/icons-material/Close";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import SmartToyOutlinedIcon from "@mui/icons-material/SmartToyOutlined";
import { GridLoader } from "react-spinners";
import { PRIORITY_NAMES, type PipelineState, type Workspace } from "shared";
import { errorMessage } from "../api/client.ts";
import { useCoordinator } from "../api/coordinator.ts";
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useRerunSetup,
  useSetupLog,
  useWorkspace,
} from "../api/workspaces.ts";
import { useLinearIssue } from "../api/integrations.ts";
import PriorityIcon from "./icons/PriorityIcon.tsx";
import StatusIcon from "./icons/StatusIcon.tsx";
import VSCodeIcon from "./icons/VSCodeIcon.tsx";
import CoordinatorDialog from "./CoordinatorDialog.tsx";
import {
  useMediaQuery,
  useTheme,
  Alert,
  Badge,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

// One property row: an icon that says what the property is, then its value, and
// optional actions at the far right. The label shows when hovering the icon.
function Property({
  label,
  icon,
  action,
  children,
}: {
  label: string;
  icon: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", minHeight: 32 }}
    >
      <Tooltip title={label} placement="left">
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            width: 20,
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      </Tooltip>
      <Typography variant="body2" component="div" sx={{ minWidth: 0, flex: 1 }}>
        {children}
      </Typography>
      {action}
    </Stack>
  );
}

// A section's title, with an optional action button at the far right.
function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", justifyContent: "space-between" }}
    >
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {action}
    </Stack>
  );
}

// Monospace text that wraps anywhere, for paths and branch names.
function Code({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        fontFamily: "monospace",
        fontSize: "0.8125rem",
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </Box>
  );
}

// A link that opens the folder in a new VS Code window (windowId=_blank). The path is
// on the machine running zini, so this only works in a browser on that same machine.
// vscode://file/ takes forward slashes and no leading slash (C:/Users/… or home/…).
const vscodeUrl = (path: string) =>
  `vscode://file/${encodeURI(path.replace(/\\/g, "/").replace(/^\//, ""))}?windowId=_blank`;

// The end of the workspace's setup output; refetched every couple of seconds while
// setup is running, so it can be followed.
function SetupLogDialog({
  workspace,
  open,
  onClose,
}: {
  workspace: Workspace;
  open: boolean;
  onClose: () => void;
}) {
  const running = workspace.setupStatus === "running";
  const log = useSetupLog(workspace.issueId, open, running);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Setup log</DialogTitle>
      <DialogContent>
        {log.isPending && <Skeleton height={120} />}
        {log.isError && <Alert severity="error">{errorMessage(log.error)}</Alert>}
        {log.isSuccess && (
          <Box
            component="pre"
            sx={{
              m: 0,
              fontFamily: "monospace",
              fontSize: "0.8125rem",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {log.data || "No setup has run in this workspace."}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// Where the workspace's setup is at, with its log and, unless it's running, a way to
// run it again (e.g. after fixing the command in Settings).
function SetupStatusRow({ workspace }: { workspace: Workspace }) {
  const rerun = useRerunSetup();
  const [showLog, setShowLog] = useState(false);
  const { setupStatus, setupError } = workspace;

  const status = {
    running: {
      label: "Setting up",
      icon: <CircularProgress size={16} />,
      text: "Setting up…",
    },
    ready: {
      label: "Set up",
      icon: <CheckCircleOutlinedIcon fontSize="small" color="success" />,
      text: "Ready to work in",
    },
    failed: {
      label: "Setup failed",
      icon: <ErrorOutlineOutlinedIcon fontSize="small" color="error" />,
      text: `Setup failed: ${setupError ?? "unknown error"}`,
    },
  }[setupStatus];

  return (
    <>
      <Property
        label={status.label}
        icon={status.icon}
        action={
          <Stack direction="row">
            <Tooltip title="Setup log">
              <IconButton size="small" onClick={() => setShowLog(true)} aria-label="Setup log">
                <ArticleOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {setupStatus !== "running" && (
              <Tooltip title="Re-run setup">
                <IconButton
                  size="small"
                  loading={rerun.isPending}
                  onClick={() => rerun.mutate(workspace.issueId)}
                  aria-label="Re-run setup"
                >
                  <ReplayIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        }
      >
        {/* A failed setup needs attention; otherwise it's just status. */}
        <Box
          component="span"
          sx={{ color: setupStatus === "failed" ? "text.primary" : "text.secondary" }}
        >
          {status.text}
        </Box>
      </Property>
      {rerun.isError && <Alert severity="error">{errorMessage(rerun.error)}</Alert>}
      <SetupLogDialog workspace={workspace} open={showLog} onClose={() => setShowLog(false)} />
    </>
  );
}

// A long path shortened in the middle, keeping its start and its end (the
// workspace's folder).
function shortPath(path: string, max = 36) {
  if (path.length <= max) return path;
  const tail = Math.ceil(max * 0.6);
  return `${path.slice(0, max - tail - 1)}…${path.slice(-tail)}`;
}

// The workspace's folder, shortened, with the whole path in a tooltip and a button to
// copy it. Copying needs a secure page (https or localhost), so the button is hidden
// otherwise.
function FolderRow({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = Boolean(navigator.clipboard);

  function copy() {
    navigator.clipboard.writeText(path).then(
      () => setCopied(true),
      () => {},
    );
  }

  return (
    <Property
      label="Folder"
      icon={<FolderOutlinedIcon fontSize="small" color="action" />}
      action={
        canCopy && (
          <Tooltip title={copied ? "Copied" : "Copy path"} onClose={() => setCopied(false)}>
            <IconButton size="small" onClick={copy} aria-label="Copy path">
              <ContentCopyOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )
      }
    >
      <Tooltip title={path}>
        <Box
          component="span"
          sx={{ fontFamily: "monospace", fontSize: "0.8125rem", whiteSpace: "nowrap" }}
        >
          {shortPath(path)}
        </Box>
      </Tooltip>
    </Property>
  );
}

// Where the issue's pipeline is at, for the coordinator button: its mark (a spinner
// while working, a dot when it needs you or failed) and its tooltip.
// Finished counts as done even though it waits for feedback: that's optional.
function pipelineStatus(pipeline: PipelineState | undefined) {
  if (!pipeline?.started) return null;
  if (pipeline.running) return { mark: "working", tooltip: `Working: ${pipeline.running}` } as const;
  if (pipeline.error) return { mark: "failed", tooltip: `Failed: ${pipeline.error}` } as const;
  if (pipeline.finished) return { mark: null, tooltip: "Done" } as const;
  const waiting = pipeline.waiting;
  if (!waiting) return null;
  const tooltip =
    waiting.kind === "questions"
      ? `Needs you: answer the ${waiting.from}'s questions`
      : waiting.kind === "approve_plan"
        ? "Needs you: approve the plan"
        : "Needs you";
  return { mark: "needs_you", tooltip } as const;
}

// Opens the issue's coordinator, showing where the pipeline is at so you know without
// opening it: its icon is a spinner while a subagent works, and a dot on the button
// says it needs you (orange) or failed (red). The tooltip says what exactly.
function CoordinatorButton({ issueId }: { issueId: string }) {
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  const status = pipelineStatus(useCoordinator(issueId).data);

  const icon =
    status?.mark === "working" ? (
      // Its grid is 3 × (size + 4)px wide: 21px, about the robot icon's size.
      <Box sx={{ display: "flex" }}>
        <GridLoader size={3} color={(theme.vars || theme).palette.primary.contrastText} />
      </Box>
    ) : (
      <SmartToyOutlinedIcon />
    );
  const dot = status?.mark === "needs_you" || status?.mark === "failed";

  return (
    <>
      {/* The dot sits on the button's top-right corner; the badge spans the full width
          so the button still can. */}
      <Badge
        variant="dot"
        color={status?.mark === "failed" ? "error" : "warning"}
        invisible={!dot}
        sx={{ width: "100%" }}
      >
        <Tooltip title={status?.tooltip ?? ""}>
          <Button variant="contained" fullWidth startIcon={icon} onClick={() => setOpen(true)}>
            Open coordinator
          </Button>
        </Tooltip>
      </Badge>
      <CoordinatorDialog issueId={issueId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// The issue's git workspace: a button to create it, or its folder with
// buttons to open it in VS Code and to delete it.
// linearBranch is the branch Linear suggests for the issue, once it has loaded.
function WorkspaceSection({
  issueId,
  linearBranch,
}: {
  issueId: string;
  linearBranch?: string;
}) {
  const workspace = useWorkspace(issueId);
  const create = useCreateWorkspace();
  const remove = useDeleteWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  function handleDelete() {
    remove.mutate(issueId, { onSuccess: () => setConfirming(false) });
  }

  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <SectionHeader
        title="Workspace"
        action={
          workspace.data && (
            <Stack direction="row">
              <Tooltip title="Open in VS Code">
                <IconButton
                  size="small"
                  href={vscodeUrl(workspace.data.path)}
                  aria-label="Open in VS Code"
                >
                  <VSCodeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton
                size="small"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                aria-label="More actions"
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
              <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={() => setMenuAnchor(null)}
              >
                {/* Not while setup or the coordinator is running in it. */}
                <MenuItem
                  disabled={
                    workspace.data.setupStatus === "running" || workspace.data.coordinatorRunning
                  }
                  onClick={() => {
                    setMenuAnchor(null);
                    setConfirming(true);
                  }}
                  sx={{ color: "error.main" }}
                >
                  <ListItemIcon>
                    <DeleteOutlinedIcon fontSize="small" color="error" />
                  </ListItemIcon>
                  <ListItemText>Delete workspace</ListItemText>
                </MenuItem>
              </Menu>
            </Stack>
          )
        }
      />

      {workspace.isPending && <Skeleton height={32} />}
      {workspace.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {errorMessage(workspace.error)}
        </Alert>
      )}

      {workspace.data === null && (
        <Stack spacing={1.5} sx={{ mt: 0.5, alignItems: "flex-start" }}>
          <Typography variant="body2" color="text.secondary">
            A local copy of the repo on this issue's branch, ready for work.
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            loading={create.isPending}
            onClick={() => create.mutate(issueId)}
          >
            Create workspace
          </Button>
          {create.isError && (
            <Alert severity="error">{errorMessage(create.error)}</Alert>
          )}
        </Stack>
      )}

      {workspace.data && (
        <Stack sx={{ mt: 0.5 }}>
          <FolderRow path={workspace.data.path} />
          {/* Linear's suggested branch can change (e.g. the issue is renamed) while the
              workspace keeps the branch it was created on. */}
          {linearBranch !== undefined &&
            (workspace.data.branch === linearBranch ? (
              <Property
                label="Branch matches Linear"
                icon={
                  <CheckCircleOutlinedIcon fontSize="small" color="success" />
                }
              >
                <Box component="span" sx={{ color: "text.secondary" }}>
                  Branch synced with Linear
                </Box>
              </Property>
            ) : (
              <Property
                label="Branch differs from Linear"
                icon={<CancelOutlinedIcon fontSize="small" color="warning" />}
              >
                <Code>{workspace.data.branch}</Code>
              </Property>
            ))}
          <SetupStatusRow workspace={workspace.data} />
          {/* The coordinator works in the workspace, so only once it's set up. */}
          {workspace.data.setupStatus === "ready" && (
            <Box sx={{ mt: 1.5 }}>
              <CoordinatorButton issueId={issueId} />
            </Box>
          )}

          <Dialog
            open={confirming}
            onClose={() => !remove.isPending && setConfirming(false)}
          >
            <DialogTitle>Delete this workspace?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                This deletes the folder and the local branch{" "}
                <Code>{workspace.data.branch}</Code>, including any uncommitted
                changes, and the coordinator conversation. The branch on GitHub is kept.
              </DialogContentText>
              {remove.isError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {errorMessage(remove.error)}
                </Alert>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => setConfirming(false)}
                disabled={remove.isPending}
              >
                Cancel
              </Button>
              <Button
                color="error"
                loading={remove.isPending}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </DialogActions>
          </Dialog>
        </Stack>
      )}
    </Box>
  );
}

// The control panel for one Linear issue, fetched by id when it opens.
function IssuePanel({
  issueId,
  onClose,
}: {
  issueId: string;
  onClose: () => void;
}) {
  const issue = useLinearIssue(issueId);
  const data = issue.data;
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));

  return (
    <Paper
      square
      elevation={0}
      sx={{
        width: isSmallScreen ? "100%" : 430,
        flexShrink: 0,
        borderLeft: isSmallScreen ? undefined : 1,
        borderColor: "divider",
        overflowY: "auto",
        bgcolor: isSmallScreen ? "background.default" : undefined,
      }}
    >
      {/* Identifier and actions, then the title. */}
      <Box sx={{ px: 2.5, pt: 1.5, pb: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {data ? data.identifier : <Skeleton width={56} />}
          </Typography>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <Typography variant="h6" component="h2" sx={{ lineHeight: 1.3 }}>
          {data ? data.title : <Skeleton />}
        </Typography>
      </Box>

      <Divider />

      <Box sx={{ px: 2.5, py: 2 }}>
        <SectionHeader
          title="Properties"
          action={
            data && (
              <Tooltip title="Open in Linear">
                <IconButton
                  size="small"
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open in Linear"
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )
          }
        />

        {issue.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {errorMessage(issue.error)}
          </Alert>
        )}

        {issue.isPending && (
          <Stack spacing={1} sx={{ mt: 0.5 }}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} height={32} />
            ))}
          </Stack>
        )}

        {data && (
          <Stack sx={{ mt: 0.5 }}>
            <Property
              label="Status"
              icon={
                <StatusIcon
                  type={data.state.type}
                  name={data.state.name}
                  fontSize="small"
                />
              }
            >
              {data.state.name}
            </Property>
            <Property
              label="Priority"
              icon={<PriorityIcon priority={data.priority} fontSize="small" />}
            >
              {PRIORITY_NAMES[data.priority] ?? data.priority}
            </Property>
            <Property
              label="Assignee"
              icon={
                <PersonOutlinedIcon
                  fontSize="small"
                  color={data.assignee ? "action" : "disabled"}
                />
              }
            >
              {data.assignee?.name ?? (
                <Box component="span" sx={{ color: "text.secondary" }}>
                  Unassigned
                </Box>
              )}
            </Property>
            <Property
              label="Branch"
              icon={<AccountTreeOutlinedIcon fontSize="small" color="action" />}
            >
              <Code>{data.branchName}</Code>
            </Property>
          </Stack>
        )}
      </Box>

      <Divider />

      <WorkspaceSection issueId={issueId} linearBranch={data?.branchName} />
    </Paper>
  );
}

export default IssuePanel;
