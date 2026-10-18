import { Box, Typography } from "@mui/material";
import { Link } from "react-router";
import { useLinearIssue } from "../../api/integrations";
import CampaignIcon from "@mui/icons-material/Campaign";
type SystemMessageProps = {
  issueId?: string;
  content: string;
};

const SystemMessage = ({ issueId, content }: SystemMessageProps) => {
  const { data } = issueId ? useLinearIssue(issueId) : {};

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        color: "text.secondary",
      }}
    >
      <CampaignIcon fontSize="small" />

      {issueId && (
        <Typography
          variant="body2"
          component={Link}
          to={"/issues/" + issueId}
          sx={{
            color: "inherit",
            flexShrink: 0,
          }}
          noWrap
        >
          <i>{data?.identifier || "Loading..."}</i>
        </Typography>
      )}
      <Typography variant="body2" noWrap>
        <i>{content}</i>
      </Typography>
    </Box>
  );
};

export default SystemMessage;
