import { useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import KeyIcon from "@mui/icons-material/Key";
import SearchIcon from "@mui/icons-material/Search";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { useDevelopmentEnvironment, useSaveDevelopmentEnvironment } from "../api/developmentEnvironment.ts";
import { errorMessage } from "../api/client.ts";

// A row summing up the project's development variables, for a List; they're managed in a
// dialog, since a project can have dozens.
export default function DevelopmentEnvironmentRow({ projectId, repository }: { projectId: number; repository: string }) {
  const status = useDevelopmentEnvironment(projectId);
  const [open, setOpen] = useState(false);
  const variables = status.data?.variables ?? [];
  const empty = variables.filter((variable) => !variable.configured).length;
  const summary = status.isPending
    ? "Loading…"
    : `${variables.length} variable${variables.length === 1 ? "" : "s"}${empty ? ` · ${empty} empty` : ""}`;

  return (
    <>
      <ListItemButton onClick={() => setOpen(true)} sx={{ gap: 2, px: 2 }}>
        <ListItemIcon sx={{ minWidth: 0 }}>
          <KeyIcon />
        </ListItemIcon>
        <ListItemText
          primary="Development environment variables"
          secondary="Credentials and config for setup, Reviewer, QA and previews."
        />
        <Chip size="small" variant="outlined" label={summary} />
        <ChevronRightIcon color="action" />
      </ListItemButton>
      {status.isError && (
        <Alert severity="error" sx={{ m: 2, mt: 0 }}>
          {errorMessage(status.error)}
        </Alert>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth scroll="paper">
        {open && <VariablesDialogContent projectId={projectId} repository={repository} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

// Mounted only while the dialog is open, so the search and form start empty each time.
function VariablesDialogContent({
  projectId,
  repository,
  onClose,
}: {
  projectId: number;
  repository: string;
  onClose: () => void;
}) {
  const status = useDevelopmentEnvironment(projectId);
  const save = useSaveDevelopmentEnvironment(projectId);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const variables = status.data?.variables ?? [];
  const query = search.trim().toLowerCase();
  const matches = variables.filter((variable) => variable.name.toLowerCase().includes(query));

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      { variables: [{ name: name.trim(), value }] },
      {
        onSuccess: () => {
          setName("");
          setValue("");
        },
      },
    );
  }

  return (
    <>
      <DialogTitle component="div">
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <KeyIcon />
          <Typography variant="h6">Development environment variables</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3}>
          <DialogContentText variant="body2">
            For {repository}. Used by setup, Reviewer, QA and previews. Values are never shown after saving. Restart running apps
            to apply changes. Zini&apos;s generated database settings take precedence.
          </DialogContentText>

          <Stack component="form" spacing={1.5} onSubmit={submit}>
            <Typography variant="subtitle2">Add or replace a variable</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                label="Name"
                placeholder="GOOGLE_GEMINI_API_KEY"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                autoComplete="off"
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                label="Value"
                type="password"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputRef={valueInput}
                required
                autoComplete="off"
                size="small"
                sx={{ flex: 1 }}
              />
              <Button type="submit" variant="contained" loading={save.isPending} sx={{ flexShrink: 0 }}>
                Save
              </Button>
            </Stack>
          </Stack>
          {save.isSuccess && <Alert severity="success">Development variables saved.</Alert>}
          {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
          {importError && <Alert severity="error">{importError}</Alert>}

          <Stack spacing={1}>
            <TextField
              placeholder={`Search ${variables.length} variables`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
              size="small"
              autoFocus
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            {status.isPending && <Typography color="text.secondary">Loading…</Typography>}
            {status.isError && <Alert severity="error">{errorMessage(status.error)}</Alert>}
            {status.isSuccess && matches.length === 0 && (
              <Typography color="text.secondary" sx={{ py: 2, textAlign: "center" }}>
                {variables.length ? `No variables match "${search.trim()}".` : "No variables yet."}
              </Typography>
            )}
            <List dense disablePadding>
              {matches.map((variable) => (
                <ListItem
                  key={variable.name}
                  divider
                  secondaryAction={
                    <Stack direction="row">
                      <Tooltip title="Replace value">
                        <IconButton
                          aria-label={`Replace ${variable.name}`}
                          disabled={save.isPending}
                          onClick={() => {
                            setName(variable.name);
                            setValue("");
                            valueInput.current?.focus();
                          }}
                        >
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove">
                        <IconButton
                          aria-label={`Remove ${variable.name}`}
                          color="error"
                          disabled={save.isPending}
                          onClick={() => save.mutate({ variables: [{ name: variable.name, remove: true }] })}
                        >
                          <DeleteOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                  sx={{ pr: 12 }}
                >
                  <ListItemText
                    primary={
                      <Box component="code" sx={{ wordBreak: "break-all" }}>
                        {variable.name}
                      </Box>
                    }
                  />
                  {!variable.configured && <Chip size="small" variant="outlined" color="warning" label="Empty" />}
                </ListItem>
              ))}
            </List>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
        <Tooltip title="Replaces matching names and adds new ones.">
          <Button component="label" startIcon={<UploadFileIcon />} disabled={save.isPending}>
            Import .env
            <input
              type="file"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setImportError(null);
                try {
                  if (file.size > 80000) throw new Error("Choose a .env file under 80 KB");
                  save.mutate({ content: await file.text() });
                } catch (error) {
                  setImportError(errorMessage(error));
                }
              }}
            />
          </Button>
        </Tooltip>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </>
  );
}
