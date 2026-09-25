import { Box, Container, IconButton, Stack, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import HomeIcon from "@mui/icons-material/Home";
import SearchIcon from "@mui/icons-material/Search";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { Link } from "react-router";

const mainItems = (tooltipPlacement: "right" | "top") => [
  <Tooltip key="home" title={"home"} placement={tooltipPlacement}>
    <IconButton component={Link} to="/">
      <HomeIcon />
    </IconButton>
  </Tooltip>,
  <Tooltip key="search" title={"search"} placement={tooltipPlacement}>
    <IconButton>
      <SearchIcon />
    </IconButton>
  </Tooltip>,
  <Tooltip
    key="product-manager"
    title="product manager"
    placement={tooltipPlacement}
  >
    <IconButton component={Link} to="/product-manager">
      <PsychologyIcon />
    </IconButton>
  </Tooltip>,
];

const secondaryItems = (tooltipPlacement: "top" | "right") => [
  <Tooltip key="settings" title={"settings"} placement={tooltipPlacement}>
    <IconButton component={Link} to="/settings">
      <SettingsIcon />
    </IconButton>
  </Tooltip>,
];

const NavBar = ({ direction }: { direction: "row" | "column" }) => {
  return (
    <Stack
      useFlexGap
      direction={direction}
      spacing={5}
      sx={{
        height: direction === "column" ? "100vh" : undefined,
        borderColor: "divider",
        borderRightStyle: direction === "column" ? "solid" : undefined,
        borderTopStyle: direction === "row" ? "solid" : undefined,
        borderWidth: 1,
        p: 1.5,
      }}
    >
      {direction === "column" && (
        <>
          <Box sx={{ display: "flex", flex: 1, alignItems: "center" }}>
            <Stack spacing={2}>{...mainItems("right")}</Stack>
          </Box>

          <Stack>{...secondaryItems("right")}</Stack>
        </>
      )}
      {direction === "row" && (
        <Container maxWidth="sm">
          <Box
            sx={{
              display: "flex",
              width: "100%",
              justifyContent: "space-between",
            }}
          >
            {...mainItems("top")}
            {...secondaryItems("top")}
          </Box>
        </Container>
      )}
    </Stack>
  );
};

export default NavBar;
