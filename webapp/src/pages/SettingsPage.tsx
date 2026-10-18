import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { errorMessage } from "../api/client.ts";
import { useConnectIntegration, useDisconnectIntegration, useIntegrations } from "../api/integrations.ts";
import { useSaveSettings, useSettings } from "../api/settings.ts";
import { useChatGpt, useChatGptModels, useChatGptSignIn, useChatGptSignOut } from "../api/chatgpt.ts";
import type { ModelProvider, Provider, Settings } from "shared";
import {
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import DevelopmentEnvironmentCard from "../components/DevelopmentEnvironmentCard.tsx";

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

          {integrations.isPending && <Typography color="text.secondary">Loading…</Typography>}
          {integrations.isError && <Alert severity="error">{errorMessage(integrations.error)}</Alert>}

          {integrations.isSuccess && connected && !replacing && (
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <Typography sx={{ flexGrow: 1 }}>
                Connected · key ending in <code>{status?.keyHint}</code>
              </Typography>
              <Button onClick={() => setReplacing(true)}>Replace key</Button>
              <Button color="error" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
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
              {connect.isError && <Alert severity="error">{errorMessage(connect.error)}</Alert>}
              <Stack direction="row" spacing={1}>
                <Button type="submit" variant="contained" loading={connect.isPending}>
                  Connect
                </Button>
                {replacing && <Button onClick={() => setReplacing(false)}>Cancel</Button>}
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
  const [confirmRepoChange, setConfirmRepoChange] = useState(false);
  const edited = Object.keys(drafts).length > 0;
  const valueOf = (setting: keyof Settings) => drafts[setting] ?? settings.data?.[setting] ?? "";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (drafts.githubRepo && drafts.githubRepo.trim().toLowerCase() !== (settings.data?.githubRepo ?? "").toLowerCase()) {
      save.reset();
      setConfirmRepoChange(true);
      return;
    }
    save.mutate(drafts, { onSuccess: () => setDrafts({}) });
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{title}</Typography>

          {settings.isPending && <Typography color="text.secondary">Loading…</Typography>}
          {settings.isError && <Alert severity="error">{errorMessage(settings.error)}</Alert>}

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
                  disabled={save.isPending}
                />
              ))}
              {fields.some((field) => field.setting === "githubRepo") && (
                <Alert severity="warning">
                  Switching repositories deletes all workspaces, their Docker containers and volumes, and Forge history and logs.
                  Local changes and unpushed commits will be lost. Pause running Forges and stop app launches before switching.
                </Alert>
              )}
              {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
              <Stack direction="row">
                <Button type="submit" variant="contained" loading={save.isPending} disabled={!edited}>
                  Save
                </Button>
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
      <Dialog
        open={confirmRepoChange}
        onClose={() => !save.isPending && setConfirmRepoChange(false)}
        aria-labelledby="repo-change-title"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="repo-change-title">Delete workspaces and switch repository?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Switching to {drafts.githubRepo?.trim()} permanently deletes all workspaces, their Docker containers, volumes, Forge
            history and logs. Uncommitted changes and unpushed commits will be lost. This cannot be undone.
          </DialogContentText>
          {save.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={save.isPending} onClick={() => setConfirmRepoChange(false)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { ...drafts, confirmWorkspaceDeletion: true },
                {
                  onSuccess: () => {
                    setDrafts({});
                    setConfirmRepoChange(false);
                  },
                },
              )
            }
          >
            Delete workspaces and switch
          </Button>
        </DialogActions>
      </Dialog>
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
                  Run models on your ChatGPT plan (Plus or Pro) instead of OpenRouter. Usage counts against your plan&apos;s
                  limits.
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
function ModelCard({
  title,
  provider: providerSetting,
  model: modelSetting,
  helperText,
}: {
  title: string;
  provider: "projectLeadProvider" | "forgeProvider" | "openwikiProvider";
  model: "projectLeadModel" | "forgeModel" | "openwikiModel";
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
          <Alert severity="info">The model must support text and image inputs.</Alert>
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

function ConductorCard() {
  const settings = useSettings();
  const save = useSaveSettings();
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Conductor</Typography>
          <Typography variant="body2" color="text.secondary">
            Automatically start Forges for unstarted Linear issues. Turning this off prevents new starts; existing Forge runs
            continue.
          </Typography>
          <FormControlLabel
            label="Enable conductor"
            control={
              <Switch
                checked={settings.data?.conductorEnabled !== "false"}
                disabled={!settings.isSuccess || save.isPending}
                onChange={(_event, checked) => save.mutate({ conductorEnabled: String(checked) })}
              />
            }
          />
          {settings.isError && <Alert severity="error">{errorMessage(settings.error)}</Alert>}
          {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  const settings = useSettings();
  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Settings
      </Typography>
      <Stack spacing={2}>
        <KeyCard provider="linear" name="Linear" helperText="Create a personal API key in your Linear settings." />
        <KeyCard provider="openrouter" name="OpenRouter" helperText="Create an API key at openrouter.ai/keys." />
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
        {settings.data?.githubRepo && (
          <DevelopmentEnvironmentCard key={settings.data.githubRepo} repository={settings.data.githubRepo} />
        )}
        <ChatGptCard />
        <ModelCard
          title="Project Lead"
          provider="projectLeadProvider"
          model="projectLeadModel"
          helperText="An OpenRouter model ID that supports tool calling."
        />
        <ModelCard
          title="Forge"
          provider="forgeProvider"
          model="forgeModel"
          helperText="An OpenRouter model ID for the Forge, which guides implementing an issue in its workspace."
        />
        <ModelCard
          title="OpenWiki"
          provider="openwikiProvider"
          model="openwikiModel"
          helperText="An OpenRouter model ID used to generate the repo's wiki docs."
        />
        <AppearanceCard />
        <ConductorCard />
      </Stack>
    </Container>
  );
}

export default SettingsPage;
