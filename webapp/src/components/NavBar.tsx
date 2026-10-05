import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Menu, MenuItem, Stack, Typography,
} from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import ScienceIcon from "@mui/icons-material/Science";
import { Link, useLocation, useNavigate } from "react-router";
import { useLinearIssues } from "../api/integrations.ts";
import SessionsSection, { IssueItems } from "./navbar/SessionsSection.tsx";
import Profile from "./navbar/Profile.tsx";
import NavBarItem from "./navbar/NavBarItem.tsx";
import { useDeleteThread, useThreads } from "../api/productManager.ts";
import SessionItem from "./navbar/SessionItem";
import AddIcon from "@mui/icons-material/Add";
import { useId, useState } from "react";
import type { ThreadSummary } from "shared";
import { errorMessage } from "../api/client.ts";

const NavBar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: linearIssuesUnstarted } = useLinearIssues(["unstarted"]);
  const { data: linearIssuesStarted } = useLinearIssues(["started"]);
  const { data: linearIssuesBacklog } = useLinearIssues(["backlog"]);
  const { data: pmThreads, isPending: pmThreadsIsPending } = useThreads();
  const deleteThread = useDeleteThread();
  const [menu, setMenu] = useState<{
    position: { top: number; left: number };
    thread: ThreadSummary;
  } | null>(null);
  const [threadToDelete, setThreadToDelete] = useState<ThreadSummary | null>(null);
  const menuId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const menuThread = pmThreads?.find((thread) => thread.id === menu?.thread.id) ?? menu?.thread;
  const deletingRunningThread = Boolean(
    pmThreads?.find((thread) => thread.id === threadToDelete?.id)?.running,
  );

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
        p: 2,
        width: 280,
        maxWidth: "100%",
        userSelect: "none",
        overflow: "auto",
      }}
    >
      <Button
        component={Link}
        to={"/product-manager"}
        size="small"
        variant="outlined"
        startIcon={<AddIcon sx={{ fontSize: 17 }} />}
        sx={{
          borderColor: "divider",
          color: (theme) =>
            (theme.vars || theme).palette.text.secondary + " !important",
        }}
      >
        New Thread
      </Button>

      <Typography variant="subtitle2" color="textSecondary">
        PRODUCT MANAGERS
      </Typography>

      <Stack>
        {pmThreadsIsPending && <Typography variant="body2" color="textSecondary">Loading...</Typography>}
        {pmThreads?.map((i) => (
          <SessionItem
            key={i.id}
            title={i.title}
            updatedAt={i.createdAt}
            selected={location.pathname === "/product-manager/" + i.id}
            handleClick={() => navigate("/product-manager/" + i.id)}
            loading={i.running}
            handleContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ position: { top: event.clientY, left: event.clientX }, thread: i });
            }}
          />
        ))}
      </Stack>

      <Typography variant="subtitle2" color="textSecondary" sx={{ mt: 1.5 }}>
        COORDINTORS
      </Typography>
      <SessionsSection defaultOpen={true} title="Unstarted">
        <IssueItems issues={linearIssuesUnstarted} />
      </SessionsSection>
      <SessionsSection defaultOpen={true} title="Started">
        <IssueItems issues={linearIssuesStarted} />
      </SessionsSection>

      <SessionsSection defaultOpen={false} title="Backlog">
        <IssueItems issues={linearIssuesBacklog} />
      </SessionsSection>

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
            Delete “{threadToDelete?.title}” and its saved conversation? This cannot be undone.
          </DialogContentText>
          {deletingRunningThread && (
            <Alert severity="warning" sx={{ mt: 2 }}>Stop the thread before deleting it.</Alert>
          )}
          {deleteThread.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(deleteThread.error)}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog} disabled={deleteThread.isPending}>Cancel</Button>
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
