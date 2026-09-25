import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  errorMessage,
  useConnectIntegration,
  useDisconnectIntegration,
  useIntegrations,
  useSaveSettings,
  useSettings,
} from "../api.ts";
import type { Provider, Settings } from "shared";
import { Container, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";

type KeyCardProps = { provider: Provider; name: string; helperText: string };

function KeyCard({ provider, name, helperText }: KeyCardProps) {
  const integrations = useIntegrations();
  const connect = useConnectIntegration(provider);
  const disconnect = useDisconnectIntegration(provider);
  const [apiKey, setApiKey] = useState("");
  const [replacing, setReplacing] = useState(false);

  const status = integrations.data?.[provider];
  const connected = status?.connected ?? false;
  const showForm = !connected || replacing;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    connect.mutate(apiKey, {
      onSuccess: () => {
        setApiKey("");
        setReplacing(false);
      },
    });
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{name}</Typography>

          {integrations.isPending && (
            <Typography color="text.secondary">Loading…</Typography>
          )}
          {integrations.isError && (
            <Alert severity="error">{errorMessage(integrations.error)}</Alert>
          )}

          {integrations.isSuccess && connected && !replacing && (
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography sx={{ flexGrow: 1 }}>
                Connected · key ending in <code>{status?.keyHint}</code>
              </Typography>
              <Button onClick={() => setReplacing(true)}>Replace key</Button>
              <Button
                color="error"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </Stack>
          )}

          {integrations.isSuccess && showForm && (
            <Stack component="form" spacing={2} onSubmit={handleSubmit}>
              <TextField
                label={`${name} API key`}
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText={helperText}
                autoComplete="off"
                required
              />
              {connect.isError && (
                <Alert severity="error">{errorMessage(connect.error)}</Alert>
              )}
              <Stack direction="row" spacing={1}>
                <Button
                  type="submit"
                  variant="contained"
                  loading={connect.isPending}
                >
                  Connect
                </Button>
                {replacing && (
                  <Button onClick={() => setReplacing(false)}>Cancel</Button>
                )}
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// One text field for one setting. An optional one can be left empty, which clears it.
type SettingField = {
  setting: keyof Settings;
  label: string;
  placeholder: string;
  helperText: string;
  optional?: boolean;
};

// A card of setting fields saved together.
function SettingCard({ title, fields }: { title: string; fields: SettingField[] }) {
  const settings = useSettings();
  const save = useSaveSettings();
  // Only the edited fields; the others show their saved value.
  const [drafts, setDrafts] = useState<Partial<Record<keyof Settings, string>>>({});
  const edited = Object.keys(drafts).length > 0;
  const valueOf = (setting: keyof Settings) => drafts[setting] ?? settings.data?.[setting] ?? "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(drafts, { onSuccess: () => setDrafts({}) });
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{title}</Typography>

          {settings.isPending && (
            <Typography color="text.secondary">Loading…</Typography>
          )}
          {settings.isError && (
            <Alert severity="error">{errorMessage(settings.error)}</Alert>
          )}

          {settings.isSuccess && (
            <Stack component="form" spacing={2} onSubmit={handleSubmit}>
              {fields.map(({ setting, label, placeholder, helperText, optional }) => (
                <TextField
                  key={setting}
                  label={label}
                  value={valueOf(setting)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [setting]: e.target.value }))}
                  placeholder={placeholder}
                  helperText={helperText}
                  autoComplete="off"
                  required={!optional}
                />
              ))}
              {save.isError && (
                <Alert severity="error">{errorMessage(save.error)}</Alert>
              )}
              <Stack direction="row">
                <Button
                  type="submit"
                  variant="contained"
                  loading={save.isPending}
                  disabled={!edited}
                >
                  Save
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// setMode also saves the choice in localStorage, so it survives reloads.
function AppearanceCard() {
  const { mode, setMode } = useColorScheme();

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Appearance</Typography>
          <ToggleButtonGroup
            exclusive
            value={mode ?? "dark"}
            onChange={(_e, value: "light" | "dark" | null) => value && setMode(value)}
          >
            <ToggleButton value="dark">Dark</ToggleButton>
            <ToggleButton value="light">Light</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Settings
      </Typography>
      <Stack spacing={2}>
        <KeyCard
          provider="linear"
          name="Linear"
          helperText="Create a personal API key in your Linear settings."
        />
        <KeyCard
          provider="openrouter"
          name="OpenRouter"
          helperText="Create an API key at openrouter.ai/keys."
        />
        <KeyCard
          provider="github"
          name="GitHub"
          helperText="Create a fine-grained token at github.com/settings/personal-access-tokens. Under Repository access, select your repo; under Permissions, set Contents and Pull requests to Read and write, so agents can push branches and open PRs."
        />
        <SettingCard
          title="Repository"
          fields={[
            {
              setting: "githubRepo",
              label: "GitHub repository",
              placeholder: "owner/name",
              helperText:
                "The repo your Linear issues are about, as owner/name. Connect GitHub first; the token needs access to this repo.",
            },
          ]}
        />
        <SettingCard
          title="Workspace setup"
          fields={[
            {
              setting: "workspaceSetupCommand",
              label: "Setup command",
              placeholder: "npm ci",
              helperText:
                "Runs in each new workspace to get it ready, e.g. installing dependencies. Uses cmd on Windows and sh elsewhere. Leave empty for none.",
              optional: true,
            },
            {
              setting: "workspaceSetupTimeoutMinutes",
              label: "Timeout (minutes)",
              placeholder: "15",
              helperText: "Setup is stopped and marked failed after this long. 15 minutes if empty.",
              optional: true,
            },
          ]}
        />
        <SettingCard
          title="Product manager"
          fields={[
            {
              setting: "productManagerModel",
              label: "Model",
              placeholder: "anthropic/claude-sonnet-5",
              helperText: "An OpenRouter model ID that supports tool calling.",
            },
          ]}
        />
        <AppearanceCard />
      </Stack>
    </Container>
  );
}

export default SettingsPage;
