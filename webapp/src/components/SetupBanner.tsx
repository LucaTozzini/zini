import { Alert, Button } from "@mui/material";
import { Link, useLocation } from "react-router";

// Across the top of the app, lists what's still missing, with a link to Settings.
// Hidden on Settings itself and once everything is set up.
const SetupBanner = ({ missing }: { missing: string[] | undefined }) => {
  const { pathname } = useLocation();

  if (pathname === "/settings" || !missing || missing.length === 0) return null;

  return (
    <Alert
      severity="warning"
      sx={{ flexShrink: 0, borderRadius: 0 }}
      action={
        <Button color="inherit" size="small" component={Link} to="/settings">
          Set up
        </Button>
      }
    >
      Set {missing.join(", ")} in Settings.
    </Alert>
  );
};

export default SetupBanner;
