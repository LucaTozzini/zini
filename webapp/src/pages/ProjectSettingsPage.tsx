import { useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  Alert,
  Button,
  Card,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import GitHubIcon from "@mui/icons-material/GitHub";
import { errorMessage } from "../api/client.ts";
import { useDeleteProject, useLinearTeams, useProject, useRenameProject } from "../api/projects.ts";
import DevelopmentEnvironmentRow from "../components/DevelopmentEnvironmentRow.tsx";
import LinearIcon from "../components/icons/LinearIcon.tsx";
import { useProjectId } from "../hooks/useProject.ts";
import { ProjectConnectionsCard, Section, SettingRow, SharedSettings } from "./SettingsPage.tsx";

// Mounted only while its dialog is open, so it starts from the current name.
function RenameForm({ projectId, current, onClose }: { projectId: number; current: string; onClose: () => void }) {
  const rename = useRenameProject(projectId);
  const [name, setName] = useState(current);

  function submit(e: FormEvent) {
    e.preventDefault();
    rename.mutate(name.trim(), { onSuccess: onClose });
  }

  return (
    <form onSubmit={submit}>
      <DialogTitle>Rename project</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
          {rename.isError && <Alert severity="error">{errorMessage(rename.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" loading={rename.isPending} disabled={!name.trim() || name.trim() === current}>
          Save
        </Button>
      </DialogActions>
    </form>
  );
}

// A heading over the settings that apply to the same thing: this project, or all of them.
function SettingsGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Stack spacing={4}>
      <div>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: "0.08em" }}>
          {title}
        </Typography>
        <Divider />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {description}
        </Typography>
      </div>
      {children}
    </Stack>
  );
}

// The project's own settings (its name, repo and Linear team, its development variables,
// its optional services, and deleting it), then the ones every project shares.
function ProjectSettingsPage() {
  const projectId = useProjectId();
  const project = useProject(projectId).data;
  const team = useLinearTeams().data?.find((t) => t.id === project?.linearTeamId);
  const remove = useDeleteProject(projectId);
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!project) return null;

  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Settings
      </Typography>
      <Stack spacing={6}>
        <SettingsGroup title={`This project: ${project.name}`} description="Only this project uses these.">
          <Section title="Project" description="The repo the agents work on, and the Linear team whose issues are its work.">
            <Card variant="outlined">
              <List disablePadding>
                <SettingRow
                  icon={DriveFileRenameOutlineIcon}
                  name="Name"
                  description="What zini calls the project."
                  status={<Chip size="small" variant="outlined" label={project.name} sx={{ maxWidth: 240 }} />}
                  onClick={() => setRenaming(true)}
                  divider
                />
                <ListItem divider sx={{ gap: 2, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 0 }}>
                    <GitHubIcon />
                  </ListItemIcon>
                  <ListItemText primary="GitHub repository" secondary="Agents clone it into their workspaces." />
                  <Chip
                    size="small"
                    variant="outlined"
                    label={project.githubRepo}
                    component="a"
                    href={`https://github.com/${project.githubRepo}`}
                    target="_blank"
                    rel="noreferrer"
                    clickable
                    sx={{ maxWidth: 240 }}
                  />
                </ListItem>
                <ListItem divider sx={{ gap: 2, px: 2 }}>
                  <ListItemIcon sx={{ minWidth: 0 }}>
                    <LinearIcon />
                  </ListItemIcon>
                  <ListItemText primary="Linear team" secondary="Its issues are the project's work." />
                  <Chip size="small" variant="outlined" label={team ? `${team.name} (${team.key})` : "…"} />
                </ListItem>
                <DevelopmentEnvironmentRow projectId={projectId} repository={project.githubRepo} />
              </List>
            </Card>
          </Section>
          <Section
            title="Connections"
            description="Optional services for this project: its Postgres database, Google Drive and logs."
          >
            <ProjectConnectionsCard projectId={projectId} />
          </Section>
          <Section
            title="Delete project"
            description="Deletes its workspaces, Forges, chats, keys and variables. Its repo and issues stay as they are."
          >
            <div>
              <Button color="error" variant="outlined" onClick={() => setDeleting(true)}>
                Delete project…
              </Button>
            </div>
          </Section>
        </SettingsGroup>
        <SettingsGroup title="All projects" description="Shared by every project: a change here applies to all of them.">
          <SharedSettings />
        </SettingsGroup>
      </Stack>
      <Dialog open={renaming} onClose={() => setRenaming(false)} maxWidth="xs" fullWidth>
        {renaming && <RenameForm projectId={projectId} current={project.name} onClose={() => setRenaming(false)} />}
      </Dialog>
      <Dialog open={deleting} onClose={() => !remove.isPending && setDeleting(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {project.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes its workspaces, their Docker containers and volumes, Forge history, chats, keys and
            development variables. Uncommitted changes and unpushed commits will be lost. This cannot be undone.
          </DialogContentText>
          {remove.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(remove.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            loading={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => navigate("/") })}
          >
            Delete project
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default ProjectSettingsPage;
