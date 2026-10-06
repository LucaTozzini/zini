import { useState } from "react";
import {
  AppBar,
  Container,
  Typography,
  Stack,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import ThemeToggle from "./ThemeToggle";
import type { ColorModeSetting } from "../theme";

const NAV_LINKS = [
  { name: "Experience", href: "#experience" },
  { name: "Education", href: "#education" },
  { name: "Socials", href: "#socials" },
];

const Link = ({ name, href }: { name: string; href: string }) => (
  <Typography
    component={"a"}
    href={href}
    color="textPrimary"
    sx={{
      textDecoration: "none",
      position: "relative",
      "&::after": {
        content: '""',
        position: "absolute",
        left: 0,
        bottom: -4,
        height: 2,
        width: "100%",
        borderRadius: 2,
        backgroundColor: "secondary.main",
        transform: "scaleX(0)",
        transformOrigin: "left",
        transition: "transform 250ms ease",
      },
      "&:hover::after": {
        transform: "scaleX(1)",
      },
    }}
  >
    {name}
  </Typography>
);

const MyAppBar = ({
  colorMode,
  onColorModeChange,
}: {
  colorMode: ColorModeSetting;
  onColorModeChange: (mode: ColorModeSetting) => void;
}) => {
  const theme = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <AppBar
        position="sticky"
        variant="outlined"
        sx={(theme) => ({
          backgroundColor: theme.alpha(
            theme.palette.background.default,
            0.4
          ),
          backdropFilter: "blur(12px)",
          color: theme.palette.text.primary,
          py: 2,
        })}
      >
        <Container
          maxWidth="md"
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Stack
            direction={"row"}
            spacing={2}
            sx={{ display: { xs: "none", md: "flex" } }}
          >
            {NAV_LINKS.map((link) => (
              <Link key={link.href} name={link.name} href={link.href} />
            ))}
          </Stack>
          <IconButton
            aria-label="Open navigation menu"
            onClick={() => setDrawerOpen(true)}
            sx={{ display: { xs: "inline-flex", md: "none" } }}
          >
            <MenuIcon />
          </IconButton>
          <Stack direction={"row"} spacing={1} sx={{ alignItems: "center" }}>
            <ThemeToggle mode={colorMode} onChange={onColorModeChange} />
            <Box
              component={"img"}
              height={50}
              width={"auto"}
              src="/signature.png"
              alt="Luca Tozzini's signature"
              sx={{
                filter:
                  theme.palette.mode === "dark" ? "invert(1)" : "none",
              }}
            />
          </Stack>
        </Container>
      </AppBar>
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box
          sx={{ width: 240 }}
          role="presentation"
          onClick={() => setDrawerOpen(false)}
        >
          <List>
            {NAV_LINKS.map((link) => (
              <ListItemButton
                key={link.href}
                component={"a"}
                href={link.href}
              >
                <ListItemText primary={link.name} />
              </ListItemButton>
            ))}
          </List>
        </Box>
      </Drawer>
    </>
  );
};

export default MyAppBar;
