import { Box, Button, Divider, Drawer, IconButton, Stack, Typography, useMediaQuery, useTheme } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import NavBar from "./components/NavBar.tsx";
import HomeNavBar from "./components/HomeNavBar.tsx";
import SetupBanner from "./components/SetupBanner.tsx";
import DockerBanner from "./components/DockerBanner.tsx";
import { Link, Navigate, Outlet, Route, Routes, useLocation, useParams } from "react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useServerEvents } from "./api/events.ts";
import { useSetup } from "./hooks/useSetup.ts";
import { useProject } from "./api/projects.ts";
import { useWorkspace } from "./api/workspaces.ts";
import { useProjectId } from "./hooks/useProject.ts";
import SettingsPage from "./pages/SettingsPage.tsx";
import ProjectSettingsPage from "./pages/ProjectSettingsPage.tsx";
import ProjectsPage from "./pages/ProjectsPage.tsx";
import DocsPage from "./pages/DocsPage.tsx";
import DatabasePage from "./pages/DatabasePage.tsx";
import EvalsPage from "./pages/EvalsPage.tsx";
import ProjectLeadPage from "./pages/ProjectLeadPage.tsx";
import IssuePage from "./pages/IssuePage.tsx";
import LoginPage from "./pages/LoginPage.tsx";
import { useUserMe } from "./api/users.ts";

// A sidebar beside the page. On small screens the sidebar is a drawer, opened from a
// menu button and closed whenever you go somewhere.
function SidebarLayout({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const small = useMediaQuery(useTheme().breakpoints.down("md"));
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);

  return (
    <Box sx={{ display: "flex", flexDirection: small ? "column" : "row", overflow: "hidden", height: "100%" }}>
      {small ? (
        <>
          <Box sx={{ flexShrink: 0, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
            <IconButton aria-label="Open navigation" onClick={() => setNavOpen(true)}>
              <MenuIcon />
            </IconButton>
          </Box>
          <Drawer open={navOpen} onClose={() => setNavOpen(false)}>
            {nav}
          </Drawer>
        </>
      ) : (
        <>
          {nav}
          <Divider flexItem orientation={"vertical"} />
        </>
      )}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" }}>{children}</Box>
    </Box>
  );
}

// A page outside any project (the projects, Settings, Evals), beside the start sidebar.
const GlobalPage = ({ children }: { children: ReactNode }) => <SidebarLayout nav={<HomeNavBar />}>{children}</SidebarLayout>;

// A project's pages, beside its sidebar.
function ProjectApp() {
  const setup = useSetup();
  const project = useProject(useProjectId());

  if (project.isSuccess && !project.data)
    return (
      <GlobalPage>
        <Stack spacing={2} sx={{ alignItems: "center", my: 10 }}>
          <Typography variant="h6">This project doesn't exist</Typography>
          <Button variant="contained" component={Link} to="/">
            See the projects
          </Button>
        </Stack>
      </GlobalPage>
    );

  // The project lead only renders once the shared integrations are set up; until
  // then its route shows the setup banner.
  const projectLead = setup?.linear && setup.modelProvider && setup.github && setup.model ? <ProjectLeadPage /> : null;

  return (
    <SidebarLayout nav={<NavBar />}>
      <Routes>
        <Route index element={<Navigate to="project-lead" replace />} />
        <Route path="settings" element={<ProjectSettingsPage />} />
        <Route path="docs/*" element={<DocsPage />} />
        <Route path="database" element={<DatabasePage />} />
        <Route path="project-lead" element={projectLead} />
        <Route path="project-lead/:threadId" element={projectLead} />
        <Route path="issues/:issueId" element={<IssuePage />} />
        <Route path="issues/:issueId/preview" element={<IssuePage view="preview" />} />
      </Routes>
    </SidebarLayout>
  );
}

// An issue's page without its project in the URL (e.g. an app preview link): opens it
// in the project of its workspace.
function IssueRedirect({ preview = false }: { preview?: boolean }) {
  const { issueId = "" } = useParams();
  const workspace = useWorkspace(issueId);
  if (workspace.isPending) return <Box sx={{ p: 3 }}>Loading…</Box>;
  if (!workspace.data) return <Navigate to="/" replace />;
  return <Navigate to={`/projects/${workspace.data.projectId}/issues/${issueId}${preview ? "/preview" : ""}`} replace />;
}

function SignedInApp() {
  const setup = useSetup();
  // Live updates for every page: chat replies, running chats, workspace setup.
  useServerEvents();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      <DockerBanner />
      <SetupBanner missing={setup?.missing} />
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <Routes>
          <Route
            element={
              <GlobalPage>
                <Outlet />
              </GlobalPage>
            }
          >
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/evals" element={<EvalsPage />} />
          </Route>
          <Route path="/issues/:issueId" element={<IssueRedirect />} />
          <Route path="/issues/:issueId/preview" element={<IssueRedirect preview />} />
          <Route path="/projects/:projectId/*" element={<ProjectApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Box>
    </Box>
  );
}

function App() {
  const me = useUserMe();
  if (me.isPending) return <Box sx={{ p: 3 }}>Checking sign-in…</Box>;
  if (!me.data) return <LoginPage />;
  return <SignedInApp key={me.data.username} />;
}

export default App;
