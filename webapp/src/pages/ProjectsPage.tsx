import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  Alert,
  Button,
  Card,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import GitHubIcon from "@mui/icons-material/GitHub";
import type { ProjectSummary } from "shared";
import { errorMessage } from "../api/client.ts";
import { useCreateProject, useLinearTeams, useProjects } from "../api/projects.ts";
import LinearIcon from "../components/icons/LinearIcon.tsx";

type Team = { id: string; key: string; name: string };

// A project's row: its name, repo and Linear team, and how many of its Forges are running.
function ProjectRow({ project, team, divider }: { project: ProjectSummary; team: Team | undefined; divider: boolean }) {
  return (
    <ListItemButton component={Link} to={`/projects/${project.id}`} divider={divider} sx={{ gap: 2, px: 2, py: 1.5 }}>
      <ListItemText
        primary={project.name}
        slotProps={{ primary: { noWrap: true, sx: { fontWeight: 500 } }, secondary: { component: "div" } }}
        secondary={
          <Stack direction="row" spacing={2} sx={{ mt: 0.25, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
              <GitHubIcon sx={{ fontSize: 14 }} />
              <Typography variant="body2" noWrap>
                {project.githubRepo}
              </Typography>
            </Stack>
            {team && (
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
                <LinearIcon sx={{ fontSize: 14 }} />
                <Typography variant="body2" noWrap>
                  {team.name} ({team.key})
                </Typography>
              </Stack>
            )}
          </Stack>
        }
      />
      {project.runningForges > 0 && (
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={`${project.runningForges} Forge${project.runningForges === 1 ? "" : "s"} running`}
        />
      )}
      <ChevronRightIcon sx={{ color: "text.secondary" }} />
    </ListItemButton>
  );
}

// Adding a project: its repo, its Linear team (one not taken by another project) and,
// optionally, a name, which is the repo's by default. Opens the project once it's
// added, which waits for its repo to be cloned.
function NewProjectDialog({
  open,
  onClose,
  teams,
  taken,
}: {
  open: boolean;
  onClose: () => void;
  teams: Team[];
  taken: string[];
}) {
  const create = useCreateProject();
  const navigate = useNavigate();
  const [githubRepo, setGithubRepo] = useState("");
  const [linearTeamId, setLinearTeamId] = useState("");
  const [name, setName] = useState("");
  const free = teams.filter((team) => !taken.includes(team.id));

  function close() {
    if (create.isPending) return;
    create.reset();
    onClose();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      { githubRepo: githubRepo.trim(), linearTeamId, ...(name.trim() && { name: name.trim() }) },
      { onSuccess: (project) => navigate(`/projects/${project.id}`) },
    );
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <form onSubmit={submit}>
        <DialogTitle>New project</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="GitHub repository"
              placeholder="owner/name"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              required
              autoFocus
            />
            <TextField
              select
              label="Linear team"
              value={linearTeamId}
              onChange={(e) => setLinearTeamId(e.target.value)}
              required
              helperText={free.length ? "Its issues are the project's work." : "Every Linear team already has a project."}
            >
              {free.map((team) => (
                <MenuItem key={team.id} value={team.id}>
                  {team.name} ({team.key})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Name"
              placeholder={githubRepo.split("/")[1] || "The repository's name"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {create.isPending && <Alert severity="info">Cloning {githubRepo.trim()}…</Alert>}
            {create.isError && <Alert severity="error">{errorMessage(create.error)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" loading={create.isPending} disabled={!githubRepo.trim() || !linearTeamId}>
            Add project
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

// The projects, one row each, with a button to add one.
function ProjectsPage() {
  const projects = useProjects();
  const teams = useLinearTeams();
  const [adding, setAdding] = useState(false);
  const teamOf = (id: string) => teams.data?.find((team) => team.id === id);

  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Stack direction="row" sx={{ alignItems: "center", mb: 3 }}>
        <Typography variant="h4" component="h1" sx={{ flex: 1 }}>
          Projects
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          New project
        </Button>
      </Stack>
      {projects.isError && <Alert severity="error">{errorMessage(projects.error)}</Alert>}
      {projects.isSuccess && (
        <Card variant="outlined">
          {projects.data.length ? (
            <List disablePadding>
              {projects.data.map((project, i) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  team={teamOf(project.linearTeamId)}
                  divider={i < projects.data.length - 1}
                />
              ))}
            </List>
          ) : (
            <Stack spacing={0.5} sx={{ alignItems: "center", py: 6, px: 2, textAlign: "center" }}>
              <Typography>No projects yet</Typography>
              <Typography variant="body2" color="text.secondary">
                A project is a GitHub repo and the Linear team whose issues are its work.
              </Typography>
            </Stack>
          )}
        </Card>
      )}
      {teams.isError && (
        <Alert severity="warning" sx={{ mt: 3 }}>
          Couldn't load the Linear teams: {errorMessage(teams.error)}. Connect Linear in Settings to add a project.
        </Alert>
      )}
      <NewProjectDialog
        key={String(adding)}
        open={adding}
        onClose={() => setAdding(false)}
        teams={teams.data ?? []}
        taken={projects.data?.map((project) => project.linearTeamId) ?? []}
      />
    </Container>
  );
}

export default ProjectsPage;
