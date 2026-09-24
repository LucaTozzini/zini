import { Avatar, Box, Paper, Typography } from "@mui/material";

type ChatAvatarProps = {
  src: string;
  label: string;
};

const ChatAvatar = ({ src, label }: ChatAvatarProps) => {
  return (
    <Box
      sx={{
        position: "sticky",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 3,
        backgroundImage: (theme) =>
          `linear-gradient(${(theme.vars || theme).palette.background.default}, transparent)`,
      }}
    >
      <Avatar
        sx={{
          height: 55,
          width: 55,
          borderColor: "divider",
          borderStyle: "solid",
          borderWidth: 1,
        }}
        src={src}
      />
      <Paper
        elevation={10}
        sx={{ borderRadius: 100, py: 0.5, px: 1, mt: -0.5 }}
      >
        <Typography variant="body2">{label}</Typography>
      </Paper>
    </Box>
  );
};

export default ChatAvatar;