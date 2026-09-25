import { Box, useMediaQuery, useTheme } from "@mui/material";
import NavBar from "./components/NavBar.tsx";
import SetupBanner from "./components/SetupBanner.tsx";
import { Route, Routes } from "react-router";
import { useServerEvents } from "./api.ts";
import { useSetup } from "./hooks/useSetup.ts";
import HomePage from "./pages/HomePage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import ProductManagerPage from "./pages/ProductManagerPage.tsx";

function App() {
  const setup = useSetup();
  // Live updates for every page: chat replies, running chats, workspace setup.
  useServerEvents();
  const theme =useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));

  // Pages only render once what they need is set up; until then their route shows
  // only the banner. Home needs Linear; the product manager needs everything.
  const home = setup?.linear ? <HomePage /> : null;
  const productManager =
    setup?.linear &&
    setup.openRouter &&
    setup.github &&
    setup.repo &&
    setup.model ? (
      <ProductManagerPage />
    ) : null;

  return (
    <Box sx={{ display: "flex", flexDirection: {xs: "column-reverse", md: "row"}, overflow: "hidden", height: "100vh" }}>
      <NavBar direction={isSmallScreen ? "row": "column"} />

      <Box sx={{ flex: 1, overflow: "auto" }}>
        <SetupBanner missing={setup?.missing} />
        <Routes>
          <Route path="/" element={home} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/product-manager" element={productManager} />
          <Route path="/product-manager/:threadId" element={productManager} />
        </Routes>
      </Box>
    </Box>
  );
}

export default App;
