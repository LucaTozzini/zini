import { Alert, Box, Button, Container, Snackbar, Stack, TextField, Typography } from "@mui/material";
import ZiniIcon from "../components/icons/ZiniIcon";
import { useUserLogin } from "../api/users";
import { useState } from "react";

const LoginPage = () => {
  const login = useUserLogin();
  const [showError, setShowError] = useState(false);

  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Snackbar
        open={showError}
        autoHideDuration={6000}
        onClose={() => setShowError(false)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setShowError(false)} sx={{ width: "100%" }}>
          Unable to login. Check username and password
        </Alert>
      </Snackbar>
      <Box
        sx={{
          display: "flex",
          gap: 1,
          justifyContent: "center",
          alignItems: "center",
          mb: 6,
        }}
      >
        <ZiniIcon sx={{ fontSize: 50 }} />
        <Typography component="h1" variant="h5">
          Factory
        </Typography>
      </Box>
      <Stack
        spacing={2}
        component={"form"}
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.target);
          const data = Object.fromEntries(formData.entries());
          login.mutate(
            {
              username: data.username.toString(),
              password: data.password.toString(),
            },
            {
              onError: () => {
                setShowError(true);
              },
            },
          );
        }}
      >
        <TextField label="Username" id="username" name="username" required disabled={login.isPending} />
        <TextField label="Password" id="password" name="password" type="password" required disabled={login.isPending} />
        <Button variant="contained" type="submit" loading={login.isPending}>
          Login
        </Button>
      </Stack>
    </Container>
  );
};

export default LoginPage;
