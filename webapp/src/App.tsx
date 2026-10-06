import { Box, Divider, Drawer, IconButton, useMediaQuery, useTheme } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import NavBar from "./components/NavBar.tsx";
import SetupBanner from "./components/SetupBanner.tsx";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { useServerEvents } from "./api/events.ts";
import { useSetup } from "./hooks/useSetup.ts";
import SettingsPage from "./pages/SettingsPage.tsx";
import EvalsPage from "./pages/EvalsPage.tsx";
import ProductManagerPage from "./pages/ProductManagerPage.tsx";
import IssuePage from "./pages/IssuePage.tsx";

function App() {
  const setup = useSetup();
  // Live updates for every page: chat replies, running chats, workspace setup.
  useServerEvents();
  // On small screens the navbar is a drawer, opened from a menu button and closed
  // whenever you go somewhere.
  const small = useMediaQuery(useTheme().breakpoints.down("md"));
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setNavOpen(false), [location.pathname]);
  // The product manager only renders once its integrations are set up; until
  // then its route shows the setup banner.
  const productManager =
    setup?.linear &&
    setup.openRouter &&
    setup.github &&
    setup.repo &&
    setup.model ? (
      <ProductManagerPage />
    ) : null;

  return (
    <>
    <Box sx={{ display: "flex", flexDirection: small ? "column" : "row", overflow: "hidden", height: "100dvh" }}>
      {small ? (
        <>
          <Box sx={{ flexShrink: 0, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
            <IconButton aria-label="Open navigation" onClick={() => setNavOpen(true)}>
              <MenuIcon />
            </IconButton>
          </Box>
          <Drawer open={navOpen} onClose={() => setNavOpen(false)}>
            <NavBar />
          </Drawer>
        </>
      ) : (
        <>
          <NavBar />
          <Divider flexItem orientation={"vertical"} />
        </>
      )}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto" }}>
        <SetupBanner missing={setup?.missing} />
        <Routes>
          <Route path="/" element={<Navigate to="/product-manager" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/evals" element={<EvalsPage />} />
          <Route path="/product-manager" element={productManager} />
          <Route path="/product-manager/:threadId" element={productManager} />
          <Route path="/issues/:issueId" element={<IssuePage/>}/>
        </Routes>
      </Box>
    </Box>
    </>
  );
}

export default App;
