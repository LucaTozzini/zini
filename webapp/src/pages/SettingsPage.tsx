import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { errorMessage } from "../api/client.ts";
import {
  useConnectIntegration,
  useDisconnectIntegration,
  useIntegrations,
} from "../api/integrations.ts";
import { useSaveSettings, useSettings } from "../api/settings.ts";
import { useChatGpt, useChatGptModels, useChatGptSignIn, useChatGptSignOut } from "../api/chatgpt.ts";
import type { ModelProvider, Provider, Settings } from "shared";
import { Container, MenuItem, ToggleButton, ToggleButtonGroup } from "@mui/material";
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

// Sign in with ChatGPT, to run models on your ChatGPT plan. Its callback goes to this
// machine's 127.0.0.1, so the sign-in only works in a browser on the computer running
// zini.
function ChatGptCard() {
  const status = useChatGpt();
  const signIn = useChatGptSignIn();
  const signOut = useChatGptSignOut();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">ChatGPT plan</Typography>
          {status.isError && <Alert severity="error">{errorMessage(status.error)}</Alert>}
          {signIn.isError && <Alert severity="error">{errorMessage(signIn.error)}</Alert>}
          {signOut.isError && <Alert severity="error">{errorMessage(signOut.error)}</Alert>}
          {status.data?.connected ? (
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography sx={{ flexGrow: 1 }}>Signed in as {status.data.email ?? "your ChatGPT account"}</Typography>
              <Button color="error" loading={signOut.isPending} onClick={() => signOut.mutate()}>
                Sign out
              </Button>
            </Stack>
          ) : (
            status.isSuccess && (
              <>
                <Typography variant="body2" color="text.secondary">
                  Run models on your ChatGPT plan (Plus or Pro) instead of OpenRouter. Usage counts against your
                  plan&apos;s limits.
                </Typography>
                {local ? (
                  <Stack direction="row">
                    <Button variant="contained" loading={signIn.isPending} onClick={() => signIn.mutate()}>
                      Sign in with ChatGPT
                    </Button>
                  </Stack>
                ) : (
                  <Alert severity="info">Sign in from a browser on the computer running zini.</Alert>
                )}
              </>
            )
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// A role's model and where it runs: an OpenRouter model id, or one of the ChatGPT plan's
// models. Both are saved together.
function ModelCard({ title, provider: providerSetting, model: modelSetting, helperText }: {
  title: string;
  provider: "productManagerProvider" | "coordinatorProvider";
  model: "productManagerModel" | "coordinatorModel";
  helperText: string;
}) {
  const settings = useSettings();
  const save = useSaveSettings();
  const chatGpt = useChatGpt();
  const [drafts, setDrafts] = useState<Partial<Record<keyof Settings, string>>>({});
  const provider = (drafts[providerSetting] ?? settings.data?.[providerSetting] ?? "openrouter") as ModelProvider;
  const model = drafts[modelSetting] ?? settings.data?.[modelSetting] ?? "";
  const models = useChatGptModels(provider === "chatgpt" && Boolean(chatGpt.data?.connected));

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(drafts, { onSuccess: () => setDrafts({}) });
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{title}</Typography>
          {settings.isError && <Alert severity="error">{errorMessage(settings.error)}</Alert>}
          {settings.isSuccess && (
            <Stack component="form" spacing={2} onSubmit={handleSubmit}>
              <TextField
                select
                label="Provider"
                value={provider}
                // A model id belongs to its provider, so switching starts the model afresh.
                onChange={(e) => setDrafts((d) => ({ ...d, [providerSetting]: e.target.value, [modelSetting]: "" }))}
              >
                <MenuItem value="openrouter">OpenRouter</MenuItem>
                <MenuItem value="chatgpt">ChatGPT plan</MenuItem>
              </TextField>
              {provider === "openrouter" ? (
                <TextField
                  label="Model"
                  value={model}
                  onChange={(e) => setDrafts((d) => ({ ...d, [modelSetting]: e.target.value }))}
                  placeholder="anthropic/claude-sonnet-5"
                  helperText={helperText}
                  autoComplete="off"
                  required
                />
              ) : !chatGpt.data?.connected ? (
                <Alert severity="info">Sign in with ChatGPT above to choose one of your plan&apos;s models.</Alert>
              ) : (
                <TextField
                  select
                  label="Model"
                  value={models.data?.some((m) => m.slug === model) ? model : ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [modelSetting]: e.target.value }))}
                  helperText={models.isError ? errorMessage(models.error) : "One of the models your ChatGPT plan offers."}
                  error={models.isError}
                  required
                >
                  {(models.data ?? []).map((m) => (
                    <MenuItem key={m.slug} value={m.slug}>
                      {m.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
              <Stack direction="row">
                <Button type="submit" variant="contained" loading={save.isPending} disabled={!drafts[modelSetting]}>
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
        <ChatGptCard />
        <ModelCard
          title="Product manager"
          provider="productManagerProvider"
          model="productManagerModel"
          helperText="An OpenRouter model ID that supports tool calling."
        />
        <ModelCard
          title="Coordinator"
          provider="coordinatorProvider"
          model="coordinatorModel"
          helperText="An OpenRouter model ID for the coordinator, which guides implementing an issue in its workspace."
        />
        <AppearanceCard />
      </Stack>
    </Container>
  );
}

export default SettingsPage;
