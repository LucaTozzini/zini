import {
  Alert,
  Box,
  Button,
  Dialog,
  Divider,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Menu,
  MenuItem,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  IconButton,
  Tooltip,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import StorageIcon from "@mui/icons-material/Storage";
import { Link, useLocation, useNavigate } from "react-router";
import Sidebar from "./navbar/Sidebar.tsx";
import ProjectSwitcher from "./navbar/ProjectSwitcher.tsx";
import { useLinearIssues } from "../api/integrations.ts";
import IssueItems from "./navbar/IssueItems.tsx";
import NavigationGroup from "./navbar/NavigationGroup.tsx";
import Profile from "./navbar/Profile.tsx";
import NavBarItem from "./navbar/NavBarItem.tsx";
import { useDeleteThread, useThreads } from "../api/projectLead.ts";
import SessionItem from "./navbar/SessionItem";
import AddIcon from "@mui/icons-material/Add";
import OpenWikiIcon from "./icons/OpenWikiIcon.tsx";
import { useId, useState } from "react";
import type { ThreadSummary } from "shared";
import { errorMessage } from "../api/client.ts";
import StatusIcon from "./icons/StatusIcon.tsx";
import { useProjectPath } from "../hooks/useProject.ts";

const NavBar = () => {
  const sectionHeaderSx = {
    px: 1,
    bgcolor: "transparent",
    color: "text.secondary",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: 11,
    lineHeight: "28px",
  } as const;
  const navigate = useNavigate();
  const location = useLocation();
  const projectPath = useProjectPath();
  const { data: linearIssuesUnstarted } = useLinearIssues(["unstarted"]);
  const { data: linearIssuesStarted } = useLinearIssues(["started"]);
  const { data: linearIssuesBacklog } = useLinearIssues(["backlog"]);
  const { data: projectLeadThreads, isPending: projectLeadThreadsIsPending } = useThreads();
  const issueGroups = [
    {
      id: "unstarted",
      type: "unstarted" as const,
      title: "Unstarted",
      issues: linearIssuesUnstarted,
      defaultOpen: true,
    },
    {
      id: "started",
      type: "started" as const,
      title: "Started",
      issues: linearIssuesStarted,
      defaultOpen: true,
    },
    {
      id: "backlog",
      type: "backlog" as const,
      title: "Backlog",
      issues: linearIssuesBacklog,
      defaultOpen: false,
    },
  ];
  const deleteThread = useDeleteThread();
  const [menu, setMenu] = useState<{
    position: { top: number; left: number };
    thread: ThreadSummary;
  } | null>(null);
  const [threadToDelete, setThreadToDelete] = useState<ThreadSummary | null>(null);
  const menuId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const menuThread = projectLeadThreads?.find((thread) => thread.id === menu?.thread.id) ?? menu?.thread;
  const deletingRunningThread = Boolean(projectLeadThreads?.find((thread) => thread.id === threadToDelete?.id)?.running);

  function closeDeleteDialog() {
    if (deleteThread.isPending) return;
    setThreadToDelete(null);
    deleteThread.reset();
  }

  function confirmDelete() {
    if (!threadToDelete || deleteThread.isPending || deletingRunningThread) return;
    deleteThread.mutate(threadToDelete.id, {
      onSuccess: () => {
        setThreadToDelete(null);
        if (location.pathname === projectPath("/project-lead/" + threadToDelete.id)) {
          navigate(projectPath("/project-lead"));
        }
      },
    });
  }

  return (
    <Sidebar>
      <ProjectSwitcher />

      <Box component="nav" aria-label="Chats and Forges" sx={{ minWidth: 0 }}>
        <List
          disablePadding
          subheader={
            <ListSubheader
              disableSticky
              sx={{
                ...sectionHeaderSx,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              Project Leads
              <Tooltip title="New thread">
                <IconButton
                  component={Link}
                  to={projectPath("/project-lead")}
                  size="small"
                  aria-label="New thread"
                  sx={{
                    color: "text.secondary",
                    "&:hover, &.Mui-focusVisible": { bgcolor: "action.hover" },
                  }}
                >
                  <AddIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            </ListSubheader>
          }
        >
          {(projectLeadThreadsIsPending || !projectLeadThreads?.length) && (
            <ListItem sx={{ px: 1, py: 0.25 }}>
              <ListItemText
                primary={projectLeadThreadsIsPending ? "Loading..." : "No chats yet"}
                slotProps={{
                  primary: { variant: "caption", color: "textSecondary" },
                }}
              />
            </ListItem>
          )}
          {projectLeadThreads?.map((thread) => (
            <SessionItem
              key={thread.id}
              itemId={projectPath(`/project-lead/${thread.id}`)}
              title={thread.title}
              updatedAt={thread.createdAt}
              selected={location.pathname === projectPath(`/project-lead/${thread.id}`)}
              loading={thread.running}
              onMenu={(position) => setMenu({ position, thread })}
            />
          ))}
        </List>
        <List
          disablePadding
          subheader={
            <ListSubheader disableSticky sx={{ ...sectionHeaderSx, mt: 1.5 }}>
              Forge
            </ListSubheader>
          }
        >
          {issueGroups.map((group) => (
            <NavigationGroup
              key={group.id}
              title={group.title}
              icon={<StatusIcon type={group.type} name={group.title} />}
              count={group.issues?.length}
              defaultOpen={group.defaultOpen}
              active={Boolean(group.issues?.some((issue) => location.pathname === projectPath(`/issues/${issue.id}`)))}
            >
              <IssueItems issues={group.issues} />
            </NavigationGroup>
          ))}
        </List>
      </Box>

      <Box sx={{ flex: 1 }} />
      <Box>
        <Divider sx={{ mb: 1 }} />
        <NavBarItem icon={<OpenWikiIcon />} title="OpenWiki" to={projectPath("/docs")} />
        <NavBarItem icon={<StorageIcon />} title="Database" to={projectPath("/database")} />
        <NavBarItem icon={<SettingsIcon />} title="Settings" to={projectPath("/settings")} />
        <Profile />
      </Box>
      <Menu
        id={menuId}
        anchorReference="anchorPosition"
        anchorPosition={menu?.position}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
      >
        <MenuItem
          sx={{ color: "error.main" }}
          disabled={!menuThread || menuThread.running || deleteThread.isPending}
          onClick={() => {
            if (!menuThread || menuThread.running) return;
            deleteThread.reset();
            setThreadToDelete(menuThread);
            setMenu(null);
          }}
        >
          Delete thread
        </MenuItem>
      </Menu>
      <Dialog
        open={Boolean(threadToDelete)}
        onClose={closeDeleteDialog}
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle id={dialogTitleId}>Delete thread?</DialogTitle>
        <DialogContent>
          <DialogContentText id={dialogDescriptionId}>
            Delete “{threadToDelete?.title}” and its saved conversation? This cannot be undone.
          </DialogContentText>
          {deletingRunningThread && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Stop the thread before deleting it.
            </Alert>
          )}
          {deleteThread.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(deleteThread.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={deleteThread.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={confirmDelete}
            loading={deleteThread.isPending}
            disabled={deletingRunningThread}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Sidebar>
  );
};

export default NavBar;
