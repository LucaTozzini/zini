import { Container, Box } from "@mui/material";
import NavBar from "./components/NavBar.tsx";
import LinearBanner from "./components/LinearBanner.tsx";
import { Route, Routes } from "react-router";
import HomePage from "./pages/HomePage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";

function App() {
  return (
    <Box sx={{ display: "flex" }}>
      <NavBar />

      <Container maxWidth="md" sx={{ py: 4 }}>
        <LinearBanner />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Container>
    </Box>
  );
}

export default App;
