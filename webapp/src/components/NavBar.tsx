import { Box, Container, IconButton, Stack, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import HomeIcon from "@mui/icons-material/Home";
import PsychologyIcon from "@mui/icons-material/Psychology";
import ScienceIcon from "@mui/icons-material/Science";
import { Link, useLocation } from "react-router";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { useState } from "react";
import ProfileDialog from "./ProfileDialog.tsx";

const MainItems = ({
  tooltipPlacement,
}: {
  tooltipPlacement: "right" | "top";
}) => {
  const location = useLocation();

  const style = (pathname: string) => {
    return {
      bgcolor: location.pathname === pathname ? "action.hover" : undefined,
    };
  };

  return (
    <>
      <Tooltip key="home" title={"home"} placement={tooltipPlacement}>
        <IconButton component={Link} to="/" sx={style("/")}>
          <HomeIcon />
        </IconButton>
      </Tooltip>

      <Tooltip
        key="product-manager"
        title="product manager"
        placement={tooltipPlacement}
      >
        <IconButton
          component={Link}
          to="/product-manager"
          sx={style("/product-manager")}
        >
          <PsychologyIcon />
        </IconButton>
      </Tooltip>

      <Tooltip key="evals" title="evals" placement={tooltipPlacement}>
        <IconButton component={Link} to="/evals" sx={style("/evals")}>
          <ScienceIcon />
        </IconButton>
      </Tooltip>
    </>
  );
};

const ProfileButton = ({
  tooltipPlacement,
}: {
  tooltipPlacement: "top" | "right";
}) => {
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <Tooltip key="profile" title="profile" placement={tooltipPlacement}>
        <IconButton onClick={() => setShowModal(true)}>
          <AccountCircleIcon />
        </IconButton>
      </Tooltip>
      <ProfileDialog showDialog={showModal} setShowDialog={setShowModal} />
    </>
  );
};

const SecondaryItems = ({
  tooltipPlacement,
}: {
  tooltipPlacement: "top" | "right";
}) => {
  const location = useLocation();

  const style = (pathname: string) => {
    return {
      bgcolor: location.pathname === pathname ? "action.hover" : undefined,
    };
  };
  
  return (
    <>
      <ProfileButton tooltipPlacement={tooltipPlacement} />
      <Tooltip key="settings" title={"settings"} placement={tooltipPlacement}>
        <IconButton component={Link} to="/settings" sx={style("/settings")} >
          <SettingsIcon />
        </IconButton>
      </Tooltip>
    </>
  );
};

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
            <Stack spacing={2}>
              <MainItems tooltipPlacement="right" />
            </Stack>
          </Box>

          <Stack spacing={1}><SecondaryItems tooltipPlacement="right" /></Stack>
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
            <MainItems tooltipPlacement="top" />
            <SecondaryItems tooltipPlacement="top" />
          </Box>
        </Container>
      )}
    </Stack>
  );
};

export default NavBar;
