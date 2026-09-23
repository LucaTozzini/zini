import { Alert, Button } from "@mui/material";
import { Link, useLocation } from "react-router";
import { useLinearStatus } from "../api.ts";

const LinearBanner = () => {
  const { pathname } = useLocation();
  const { data } = useLinearStatus();

  if (pathname === "/settings" || !data || data.connected) return null;

  return (
    <Alert
      severity="warning"
      sx={{ mb: 3 }}
      action={
        <Button color="inherit" size="small" component={Link} to="/settings">
          Set up
        </Button>
      }
    >
      Linear isn't connected yet.
    </Alert>
  );
};

export default LinearBanner;
