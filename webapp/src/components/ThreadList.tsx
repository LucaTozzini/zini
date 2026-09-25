import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  Menu,
  MenuItem,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Link } from "react-router";
import type { ThreadSummary } from "shared";
import { errorMessage } from "../api.ts";
import { useState } from "react";
import MoreVertIcon from "@mui/icons-material/MoreVert";

type ThreadListProps = {
  threads: ThreadSummary[] | undefined;
  error: unknown;
  activeId?: string;
  // Chats link to basePath/<id>; "New chat" links to basePath.
  basePath: string;
  onDelete: (id: string) => void;
};

type ThreadItemProps = {
  basePath: string;
  thread: ThreadSummary;
  activeId: string | undefined;
  onDelete: (id: string) => void;
};

const ThreadItem = ({ basePath, thread, activeId, onDelete }: ThreadItemProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  return (
    <ListItemButton
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      key={thread.id}
      component={Link}
      to={`${basePath}/${thread.id}`}
      selected={thread.id === activeId}
      sx={{ borderRadius: 2, px: 1.5, py: 1, mb: 0.2,

              "&.Mui-selected": { bgcolor: "action.selected" },
  "&.Mui-selected:hover": { bgcolor: "action.selected" },
       }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          gap: 2,
          alignItems: "center",
          width: "100%",
        }}
      >
        <Typography variant="body1" noWrap>
          {thread.title}
        </Typography>

        {/* The agent is working on this chat. */}
        {thread.running && !isHovered && !menuAnchor && (
          <CircularProgress size={14} sx={{ flexShrink: 0 }} aria-label="Working" />
        )}

        {/* Kept while the menu is open, since the menu is anchored to its button. */}
        {(isHovered || menuAnchor) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography color="textSecondary" variant="caption" noWrap>
              {new Date(thread.createdAt).toLocaleDateString()}
            </Typography>
            <IconButton
              size="small"
              sx={{ height: 20, width: 20 }}
              // The row is a link: don't follow it, and don't start its ripple.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setMenuAnchor(e.currentTarget);
              }}
            >
              <MoreVertIcon sx={{ fontSize: 18 }} />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              // Opens to the right of the button, top edges aligned.
              anchorOrigin={{ vertical: "top", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "left" }}
              // The menu renders in a portal, but React still bubbles its clicks
              // up to the row's link, which would open the chat.
              onClick={(e) => e.stopPropagation()}
            >
              {/* A running chat can't be deleted until its run ends. */}
              <MenuItem
                sx={{ color: "error.main" }}
                disabled={thread.running}
                onClick={() => {
                  setMenuAnchor(null);
                  onDelete(thread.id);
                }}
              >
                Delete
              </MenuItem>
            </Menu>
          </Box>
        )}
      </Box>
    </ListItemButton>
  );
};

function ThreadList({ threads, error, activeId, basePath, onDelete }: ThreadListProps) {
  return (
    <Box
      sx={{
        width: 240,
        flexShrink: 0,
        borderRightStyle: "solid",
        borderRightWidth: 1,
        borderRightColor: "divider",
        overflow: "auto",
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          position: "sticky",
          top: 0,
          left: 0,
          bgcolor: "background.default",
          zIndex: 100,
          px: 2,
          py: 1,
          color: "text.secondary",
        }}
      >
        <Typography>PM Chats</Typography>
        <IconButton component={Link} to={basePath} size="small">
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      {error != null && <Alert severity="error">{errorMessage(error)}</Alert>}
      <List dense sx={{ mx: 1,
      }}>
        {threads?.map((thread) => (
          <ThreadItem
            key={thread.id}
            activeId={activeId}
            basePath={basePath}
            thread={thread}
            onDelete={onDelete}
          />
        ))}
      </List>
    </Box>
  );
}

export default ThreadList;
