import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Menu,
  MenuItem,
  Stack,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  IconButton,
  Tooltip,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import ScienceIcon from "@mui/icons-material/Science";
import { Link, useLocation, useNavigate } from "react-router";
import { useLinearIssues } from "../api/integrations.ts";
import IssueItems from "./navbar/IssueItems.tsx";
import NavigationGroup from "./navbar/NavigationGroup.tsx";
import Profile from "./navbar/Profile.tsx";
import NavBarItem from "./navbar/NavBarItem.tsx";
import { useDeleteThread, useThreads } from "../api/productManager.ts";
import SessionItem from "./navbar/SessionItem";
import AddIcon from "@mui/icons-material/Add";
import ZiniIcon from "./icons/ZiniIcon.tsx";
import { useId, useState } from "react";
import type { ThreadSummary } from "shared";
import { errorMessage } from "../api/client.ts";

const NavBar = () => {
  const sectionHeaderSx = {
    px: 1,
    bgcolor: "transparent",
    color: "text.secondary",
    fontWeight: 500,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    lineHeight: "32px",
  } as const;
  const navigate = useNavigate();
  const location = useLocation();
  const { data: linearIssuesUnstarted } = useLinearIssues(["unstarted"]);
  const { data: linearIssuesStarted } = useLinearIssues(["started"]);
  const { data: linearIssuesBacklog } = useLinearIssues(["backlog"]);
  const { data: pmThreads, isPending: pmThreadsIsPending } = useThreads();
  const issueGroups = [
    {
      id: "unstarted",
      title: "Unstarted",
      issues: linearIssuesUnstarted,
      defaultOpen: true,
    },
    {
      id: "started",
      title: "Started",
      issues: linearIssuesStarted,
      defaultOpen: true,
    },
    {
      id: "backlog",
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
  const [threadToDelete, setThreadToDelete] = useState<ThreadSummary | null>(
    null,
  );
  const menuId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const menuThread =
    pmThreads?.find((thread) => thread.id === menu?.thread.id) ?? menu?.thread;
  const deletingRunningThread = Boolean(
    pmThreads?.find((thread) => thread.id === threadToDelete?.id)?.running,
  );

  function closeDeleteDialog() {
    if (deleteThread.isPending) return;
    setThreadToDelete(null);
    deleteThread.reset();
  }

  function confirmDelete() {
    if (!threadToDelete || deleteThread.isPending || deletingRunningThread)
      return;
    deleteThread.mutate(threadToDelete.id, {
      onSuccess: () => {
        setThreadToDelete(null);
        if (location.pathname === "/product-manager/" + threadToDelete.id) {
          navigate("/product-manager");
        }
      },
    });
  }

  return (
    <Stack
      useFlexGap
      spacing={2}
      sx={{
        height: "100dvh",
        px: 1,
        py: 1.5,
        width: 280,
        maxWidth: "100%",
        userSelect: "none",
        overflow: "auto",
      }}
    >
      <ZiniIcon sx={{ fontSize: 35 }} />

      <Box
        component="nav"
        aria-label="Chats and coordinators"
        sx={{ minWidth: 0 }}
      >
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
              Product managers
              <Tooltip title="New thread">
                <IconButton
                  component={Link}
                  to="/product-manager"
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
          {(pmThreadsIsPending || !pmThreads?.length) && (
            <ListItem sx={{ px: 1, py: 0.25 }}>
              <ListItemText
                primary={pmThreadsIsPending ? "Loading..." : "No chats yet"}
                slotProps={{
                  primary: { variant: "body2", color: "textSecondary" },
                }}
              />
            </ListItem>
          )}
          {pmThreads?.map((thread) => (
            <SessionItem
              key={thread.id}
              itemId={`/product-manager/${thread.id}`}
              title={thread.title}
              updatedAt={thread.createdAt}
              selected={location.pathname === `/product-manager/${thread.id}`}
              loading={thread.running}
              onMenu={(position) => setMenu({ position, thread })}
            />
          ))}
        </List>
        <List
          disablePadding
          subheader={
            <ListSubheader disableSticky sx={{ ...sectionHeaderSx, mt: 1.5 }}>
              Coordinators
            </ListSubheader>
          }
        >
          {issueGroups.map((group) => (
            <NavigationGroup
              key={group.id}
              title={group.title}
              defaultOpen={group.defaultOpen}
              active={Boolean(
                group.issues?.some(
                  (issue) => location.pathname === `/issues/${issue.id}`,
                ),
              )}
            >
              <IssueItems issues={group.issues} />
            </NavigationGroup>
          ))}
        </List>
      </Box>

      <Box sx={{ flex: 1 }} />
      <Box>
        <NavBarItem
          Icon={ScienceIcon}
          title="Evals"
          handleClick={() => navigate("/evals")}
        />
        <NavBarItem
          Icon={SettingsIcon}
          title="Settings"
          handleClick={() => navigate("/settings")}
        />
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
            Delete “{threadToDelete?.title}” and its saved conversation? This
            cannot be undone.
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
    </Stack>
  );
};

export default NavBar;
