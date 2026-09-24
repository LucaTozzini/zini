import { Box, IconButton, Stack, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import HomeIcon from "@mui/icons-material/Home";
import SearchIcon from "@mui/icons-material/Search";
import PsychologyIcon from '@mui/icons-material/Psychology';
import { Link } from "react-router";

const NavBar = () => {
  return (
    <Stack
      useFlexGap
      spacing={5}
      sx={{
        height: "100vh",
        borderColor: "divider",
        borderRightStyle: "solid",
        borderWidth: 1,
        p: 1.5,
      }}
    >
      <Box sx={{ display: "flex", flex: 1, alignItems: "center" }}>
        <Stack spacing={2}>
          <Tooltip title={"home"} placement={"right"}>
            <IconButton component={Link} to="/">
              <HomeIcon/>
            </IconButton>
          </Tooltip>
          <Tooltip title={"search"} placement={"right"}>
            <IconButton>
              <SearchIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title="product manager">
            <IconButton component={Link} to="/product-manager">
              <PsychologyIcon/>
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      <Stack>
        <Tooltip title={"settings"} placement={"right"}>
          <IconButton component={Link} to="/settings">
            <SettingsIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
};

export default NavBar;