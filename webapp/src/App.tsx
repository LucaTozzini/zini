import { Box, Divider } from "@mui/material";
import NavBar from "./components/NavBar.tsx";
import SetupBanner from "./components/SetupBanner.tsx";
import { Navigate, Route, Routes } from "react-router";
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
    <Box sx={{ display: "flex", overflow: "hidden", height: "100dvh" }}>
      <NavBar />
      <Divider flexItem orientation={"vertical"} />
      <Box sx={{ flex: 1, overflow: "auto" }}>
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
