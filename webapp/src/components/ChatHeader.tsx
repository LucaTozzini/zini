import {
  Avatar,
  Badge,
  Box,
  ButtonGroup,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";
import FormatListNumberedRtlIcon from "@mui/icons-material/FormatListNumberedRtl";
import CloseIcon from "@mui/icons-material/Close";
import StickyNote2Icon from "@mui/icons-material/StickyNote2";
import { useState, type ReactNode } from "react";
import type { Todo } from "shared";
import ForumIcon from "@mui/icons-material/Forum";
import MarkdownText from "./MarkdownText.tsx";

const MyAvatar = ({ src, label }: { src: string; label: string }) => (
  <Tooltip title={label} enterDelay={600}>
    <Avatar
      sx={{
        height: 55,
        width: 55,
        m: 0.2,
      }}
      src={src}
    />
  </Tooltip>
);

const MyDialog = ({
  title,
  open,
  setShowModal,
  children,
}: {
  title: string;
  open: boolean;
  setShowModal: (index: number) => void;
  // The dialog's content; "No Content" without it.
  children?: ReactNode;
}) => (
  <Dialog
    open={open}
    onClose={() => setShowModal(0)}
    maxWidth="sm"
    slotProps={{
      paper: {
        sx: {
          width: "100%",
        },
      },
    }}
  >
    <DialogTitle
      sx={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      {title}{" "}
      <IconButton size="small" onClick={() => setShowModal(0)}>
        <CloseIcon />
      </IconButton>
    </DialogTitle>
    <Divider />
    <DialogContent>
      {children || (
        <Typography sx={{ p: 5 }} align="center">
          No Content
        </Typography>
      )}
    </DialogContent>
    <Divider />
  </Dialog>
);

type ChatHeaderProps = {
  src: string;
  label: string;
  // The agent's key facts, to-do list and project notes (markdown), for the dialogs.
  facts: string[];
  todos: Todo[];
  notes: string;
  showChatlistButton: boolean;
  onChatlistButtonClick: () => void;
};
const ChatHeader = ({ src, label, facts, todos, notes, showChatlistButton, onChatlistButtonClick }: ChatHeaderProps) => {
  const [showModal, setShowModal] = useState(0);
  const openTodos = todos.filter((todo) => todo.status !== "completed").length;

  return (
    <>
      <Box
        sx={{
          position: "sticky",
          top: 0,
          // Above the messages it scrolls over: tool call lines are positioned (ButtonBase).
          zIndex: 1,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",

          p: 3,
          backgroundImage: (theme) =>
            `linear-gradient(${(theme.vars || theme).palette.background.default}, transparent)`,
        }}
      >
        <Box sx={{ flex: 1 }}>
          {showChatlistButton && <Tooltip title="Chat list">
            <Paper sx={{ width: "fit-content", borderRadius: 1000 }}>
              <IconButton size="large" onClick={onChatlistButtonClick}>
                <ForumIcon />
              </IconButton>
            </Paper>
          </Tooltip>}
        </Box>
        <Paper
          elevation={2}
          sx={{
            borderRadius: 100,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            pr: 1.5,
          }}
        >
          <MyAvatar src={src} label={label} />

          <ButtonGroup>
            <Tooltip title="Facts">
              <IconButton onClick={() => setShowModal(1)}>
                <TextSnippetIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title="To-Do">
              <IconButton onClick={() => setShowModal(2)}>
                {/* Hidden when there are none. */}
                <Badge badgeContent={openTodos} color="primary">
                  <FormatListNumberedRtlIcon />
                </Badge>
              </IconButton>
            </Tooltip>

            <Tooltip title="Project notes">
              <IconButton onClick={() => setShowModal(3)}>
                <StickyNote2Icon />
              </IconButton>
            </Tooltip>
          </ButtonGroup>
        </Paper>
        <Box sx={{ flex: 1 }}></Box>
      </Box>

      <MyDialog
        open={showModal === 1}
        title="Facts"
        setShowModal={setShowModal}
      >
        {facts.length > 0 && (
          <List>
            {facts.map((fact, i) => (
              <ListItem key={i}>
                <ListItemText primary={fact} />
              </ListItem>
            ))}
          </List>
        )}
      </MyDialog>
      <MyDialog
        open={showModal === 2}
        title="To-Do"
        setShowModal={setShowModal}
      >
        {todos.length > 0 && (
          <List dense>
            {todos.map((todo, i) => (
              <ListItem key={i} disablePadding>
                {/* Read-only: checked when completed, a spinner while in progress. */}
                <ListItemIcon>
                  <Checkbox
                    edge="start"
                    checked={todo.status === "completed"}
                    indeterminate={todo.status === "in_progress"}
                    indeterminateIcon={<CircularProgress size={18} />}
                    disableRipple
                    tabIndex={-1}
                    readOnly
                    sx={{ pointerEvents: "none" }}
                  />
                </ListItemIcon>
                <ListItemText primary={todo.content} />
              </ListItem>
            ))}
          </List>
        )}
      </MyDialog>
      {/* Shared by every chat: agents/pm.md in the backend's data folder. */}
      <MyDialog
        open={showModal === 3}
        title="Project notes"
        setShowModal={setShowModal}
      >
        {notes.trim() && <MarkdownText>{notes}</MarkdownText>}
      </MyDialog>
    </>
  );
};

export default ChatHeader;
