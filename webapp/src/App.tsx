import { Alert, Box, Button } from "@mui/material";
import NavBar from "./components/NavBar.tsx";
import { Link, Route, Routes, useLocation } from "react-router";
import { useIntegrations, useSettings } from "./api.ts";
import HomePage from "./pages/HomePage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import ProductManagerPage from "./pages/ProductManagerPage.tsx";

// The one place that works out what's set up. The banner lists what's missing and
// the routes decide what to render, both from this, so they can't disagree.
// null while loading.
function useSetup() {
  const integrations = useIntegrations();
  const settings = useSettings();

  if (!integrations.isSuccess || !settings.isSuccess) return null;

  const ready = {
    linear: integrations.data.linear.connected,
    openRouter: integrations.data.openrouter.connected,
    model: Boolean(settings.data.productManagerModel),
  };
  const missing = [];
  if (!ready.linear) missing.push("a Linear key");
  if (!ready.openRouter) missing.push("an OpenRouter key");
  if (!ready.model) missing.push("a model");
  return { ...ready, missing };
}

function App() {
  const { pathname } = useLocation();
  const setup = useSetup();
  const missing = setup?.missing;

  // Pages only render once what they need is set up; until then their route shows
  // only the banner. Home needs Linear; the product manager needs everything.
  const home = setup?.linear ? <HomePage /> : null;
  const productManager =
    setup?.linear && setup.openRouter && setup.model ? <ProductManagerPage /> : null;

  return (
    <Box sx={{ display: "flex", overflow: "hidden", height: "100vh" }}>
      <NavBar />

      <Box sx={{flex: 1, overflow: "auto" }}>
        {pathname !== "/settings" && missing && missing.length > 0 && (
          <Alert
            severity="warning"
            sx={{ mb: 3 }}
            action={
              <Button
                color="inherit"
                size="small"
                component={Link}
                to="/settings"
              >
                Set up
              </Button>
            }
          >
            Set {missing.join(", ")} in Settings.
          </Alert>
        )}
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
