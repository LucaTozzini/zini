import {
  Box,
  Alert,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Skeleton,
  Stack,
  Typography,
} from "@mui/material";
import { useConductorStatus } from "../api/conductor";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import SubscriptionsGraph from "../components/SubscriptionsGraph.tsx";
import { useSettings } from "../api/settings.ts";
import { errorMessage } from "../api/client.ts";

const ConductorCard = () => {
  const conductorStatus = useConductorStatus();
  const settings = useSettings();

  if (conductorStatus.isPending || settings.isPending) {
    return <Skeleton variant="rectangular" height={100} />;
  }

  if (conductorStatus.isError || settings.isError) {
    return <Alert severity="error">{errorMessage(conductorStatus.error ?? settings.error)}</Alert>;
  }
  const enabled = settings.data.conductorEnabled !== "false";

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="h6">Conductor</Typography>
          <Stack direction="row" spacing={1}>
            <Chip label={enabled ? "On" : "Off"} color={enabled ? "success" : "default"} />
            <Chip
              label={conductorStatus.data!.running! ? "Running" : "Idle"}
              color={conductorStatus.data!.running! ? "success" : "default"}
              icon={
                conductorStatus.data!.running! ? (
                  <CircularProgress size={14} sx={{ color: "inherit", ml: "4px" }} />
                ) : (
                  <HourglassEmptyIcon sx={{ fontSize: 14 }} />
                )
              }
            />
          </Stack>
        </Box>
        <Typography variant="body2" color="textSecondary">
          <i>Last Ran: {conductorStatus.data.lastRan ? new Date(conductorStatus.data.lastRan).toLocaleString() : "Never"}</i>
        </Typography>
      </CardContent>
    </Card>
  );
};

const SubscriptionsCard = () => {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6">Subscriptions</Typography>
        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Project Leads follow connected Forges. Open a node to view its chat or issue.
        </Typography>
        <SubscriptionsGraph />
      </CardContent>
    </Card>
  );
};

const MissionControlPage = () => {
  return (
    <Container maxWidth="md" sx={{ py: 5 }}>
      <Stack spacing={1}>
        <ConductorCard />
        <SubscriptionsCard />
      </Stack>
    </Container>
  );
};

export default MissionControlPage;
