import { Box, Divider, Stack, Typography } from "@mui/material";
import AppsIcon from "@mui/icons-material/Apps";
import ScienceIcon from "@mui/icons-material/Science";
import SettingsIcon from "@mui/icons-material/Settings";
import ZiniIcon from "./icons/ZiniIcon.tsx";
import NavBarItem from "./navbar/NavBarItem.tsx";
import Profile from "./navbar/Profile.tsx";
import Sidebar from "./navbar/Sidebar.tsx";
import { sidebarHeaderSx } from "./navbar/sidebarHeader.ts";

// The sidebar outside any project: the projects, Evals, Settings and your profile.
const HomeNavBar = () => (
  <Sidebar>
    <Stack direction="row" sx={sidebarHeaderSx}>
      <ZiniIcon sx={{ fontSize: 26 }} />
      <Typography variant="subtitle1" sx={{ fontWeight: 700, letterSpacing: "0.02em" }}>
        zini
      </Typography>
    </Stack>
    <Box component="nav" aria-label="zini">
      <NavBarItem icon={<AppsIcon />} title="Projects" to="/" />
      <NavBarItem icon={<ScienceIcon />} title="Evals" to="/evals" />
    </Box>
    <Box sx={{ flex: 1 }} />
    <Box>
      <Divider sx={{ mb: 1 }} />
      <NavBarItem icon={<SettingsIcon />} title="Settings" to="/settings" />
      <Profile />
    </Box>
  </Sidebar>
);

export default HomeNavBar;
