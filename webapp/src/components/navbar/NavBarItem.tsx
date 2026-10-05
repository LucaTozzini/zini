import type { SvgIconComponent } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";

const NavBarItem = ({
  title,
  Icon,
  handleClick,
}: {
  title: string;
  Icon: SvgIconComponent;
  handleClick: () => void;
}) => {
  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          color: "text.secondary",
          padding: 0,
          display: "flex",
          gap: 1.5,
          py: .7,
          justifyContent: "flex-start",
          alignItems: "center",
          cursor: "pointer",
          transition: "opacity 300ms",
          "&:hover": {
            opacity: 0.6,
          },
        }}
      >
        <Icon sx={{ height: 18, width: 18 }} />
        <Typography variant="body2">{title}</Typography>
      </Box>
    </>
  );
};

export default NavBarItem;
