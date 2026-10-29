import { Alert, Button } from "@mui/material";
import { Link, useLocation } from "react-router";
import { useDocker } from "../api/docker.ts";

// Across the top of the app, warns while Docker isn't running on the machine running zini, with a link to Settings,
// where it can be started. Hidden on Settings itself, which shows it there.
const DockerBanner = () => {
  const { pathname } = useLocation();
  const docker = useDocker();

  if (pathname === "/settings" || !docker.data || docker.data.running) return null;

  return (
    <Alert
      severity="warning"
      sx={{ flexShrink: 0, borderRadius: 0 }}
      action={
        <Button color="inherit" size="small" component={Link} to="/settings">
          Settings
        </Button>
      }
    >
      {docker.data.starting
        ? "Docker is starting on the zini server."
        : "Docker isn't running on the zini server, so Forges, QA and previews can't run."}
    </Alert>
  );
};

export default DockerBanner;
