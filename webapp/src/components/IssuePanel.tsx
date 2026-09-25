import { useState, type ReactNode } from "react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddIcon from "@mui/icons-material/Add";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PersonOutlinedIcon from "@mui/icons-material/PersonOutlined";
import { PRIORITY_NAMES } from "shared";
import {
  errorMessage,
  useCreateWorkspace,
  useDeleteWorkspace,
  useLinearIssue,
  useWorkspace,
} from "../api.ts";
import PriorityIcon from "./icons/PriorityIcon.tsx";
import StatusIcon from "./icons/StatusIcon.tsx";
import VSCodeIcon from "./icons/VSCodeIcon.tsx";
import {
  useMediaQuery,
  useTheme,
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";

// One property row: an icon that says what the property is, then its value. The
// label shows when hovering the icon.
function Property({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
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
      <Typography variant="body2" component="div" sx={{ minWidth: 0 }}>
        {children}
      </Typography>
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

  function handleDelete() {
    remove.mutate(issueId, { onSuccess: () => setConfirming(false) });
  }

  return (
    <Box sx={{ px: 2.5, py: 2 }}>
      <SectionHeader
        title="Workspace"
        action={
          workspace.data && (
            <Tooltip title="Open in VS Code">
              <IconButton
                size="small"
                href={vscodeUrl(workspace.data.path)}
                aria-label="Open in VS Code"
              >
                <VSCodeIcon fontSize="small" />
              </IconButton>
            </Tooltip>
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
          <Property
            label="Folder"
            icon={<FolderOutlinedIcon fontSize="small" color="action" />}
          >
            <Code>{workspace.data.path}</Code>
          </Property>
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
          <Box sx={{ mt: 1 }}>
            <Button
              color="error"
              size="small"
              startIcon={<DeleteOutlinedIcon />}
              onClick={() => setConfirming(true)}
            >
              Delete workspace
            </Button>
          </Box>

          <Dialog
            open={confirming}
            onClose={() => !remove.isPending && setConfirming(false)}
          >
            <DialogTitle>Delete this workspace?</DialogTitle>
            <DialogContent>
              <DialogContentText>
                This deletes the folder and the local branch{" "}
                <Code>{workspace.data.branch}</Code>, including any uncommitted
                changes. The branch on GitHub is kept.
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
