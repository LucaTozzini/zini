import { useMemo } from "react";
import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { Diff, Hunk, parseDiff, type FileData } from "react-diff-view";
import "react-diff-view/style/index.css";

// Changed lines are tinted green or red over the theme's surface, like GitHub's.
const INSERT = "rgba(46, 160, 67, 0.18)";
const DELETE = "rgba(248, 81, 73, 0.18)";

const TYPE_LABEL: Record<FileData["type"], string> = {
  add: "New",
  delete: "Deleted",
  modify: "Modified",
  rename: "Renamed",
  copy: "Copied",
};

function fileStats(file: FileData) {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const change of hunk.changes) {
      if (change.type === "insert") added++;
      else if (change.type === "delete") removed++;
    }
  }
  return { added, removed };
}

function FileDiff({ file }: { file: FileData }) {
  const path = file.type === "delete" ? file.oldPath : file.newPath;
  const { added, removed } = fileStats(file);

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}
      >
        <Typography variant="body2" sx={{ fontFamily: "monospace", flex: 1, overflowWrap: "anywhere" }}>
          {file.type === "rename" ? `${file.oldPath} → ${file.newPath}` : path}
        </Typography>
        <Chip size="small" variant="outlined" label={TYPE_LABEL[file.type]} />
        <Typography variant="body2" sx={{ color: "success.main" }}>
          +{added}
        </Typography>
        <Typography variant="body2" sx={{ color: "error.main" }}>
          −{removed}
        </Typography>
      </Stack>
      {file.hunks.length === 0 ? (
        // No hunks: a binary file, or a rename without changes.
        <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
          {file.isBinary ? "Binary file" : "No changes to show"}
        </Typography>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </Box>
      )}
    </Paper>
  );
}

// A workspace's changes, GitHub style: one block per file with its added (green) and
// removed (red) lines. diff is git's unified diff text.
function DiffView({ diff, truncated }: { diff: string; truncated?: boolean }) {
  const files = useMemo(() => parseDiff(diff), [diff]);

  return (
    <Stack
      spacing={1.5}
      sx={{
        // react-diff-view's colors, set from the theme so it follows light/dark mode.
        "--diff-background-color": "transparent",
        "--diff-text-color": (theme) => (theme.vars || theme).palette.text.primary,
        "--diff-font-family": "monospace",
        "--diff-code-insert-background-color": INSERT,
        "--diff-code-delete-background-color": DELETE,
        "--diff-gutter-insert-background-color": INSERT,
        "--diff-gutter-delete-background-color": DELETE,
        "--diff-gutter-selected-background-color": "transparent",
        "--diff-code-selected-background-color": "transparent",
        "& .diff": { fontSize: "0.8125rem" },
        "& .diff-gutter": { color: "text.secondary" },
      }}
    >
      {files.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No changes.
        </Typography>
      )}
      {files.map((file, i) => (
        <FileDiff key={`${file.oldPath}:${file.newPath}:${i}`} file={file} />
      ))}
      {truncated && (
        <Alert severity="info" variant="outlined">
          The diff is too large to show in full. Open the workspace in VS Code to see everything.
        </Alert>
      )}
    </Stack>
  );
}

export default DiffView;
