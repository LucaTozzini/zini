import { useId, useState, type FormEvent, type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import type { SvgIconComponent } from "@mui/icons-material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import AutoModeIcon from "@mui/icons-material/AutoMode";
import ConstructionIcon from "@mui/icons-material/Construction";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import DescriptionIcon from "@mui/icons-material/Description";
import GitHubIcon from "@mui/icons-material/GitHub";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import LinearIcon from "../components/icons/LinearIcon.tsx";
import PostgresIcon from "../components/icons/PostgresIcon.tsx";
import GoogleDriveIcon from "../components/icons/GoogleDriveIcon.tsx";
import OpenAIIcon from "../components/icons/OpenAIIcon.tsx";
import OpenRouterIcon from "../components/icons/OpenRouterIcon.tsx";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
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
  MenuItem,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import DevelopmentEnvironmentRow from "../components/DevelopmentEnvironmentRow.tsx";

// A card's title, with the service's icon in front when it has one.
function CardTitle({ icon: Icon, children }: { icon?: SvgIconComponent; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {Icon && <Icon />}
      <Typography variant="h6">{children}</Typography>
    </Stack>
  );
}

// instructions, if given, show above the key field: how to create the key. input, if
// given, replaces the key field with fields of its own that pass up the key they build.
type KeyFormProps = {
  provider: Provider;
  name: string;
  helperText?: string;
  instructions?: ReactNode;
  input?: (onChange: (key: string) => void) => ReactNode;
  // What the connected key is shown as, from its hint; "key ending in <hint>" by default.
  connectedAs?: (hint: string) => ReactNode;
};

// A service's API key: the connected key's hint, or a field to paste one.
function KeyForm({ provider, name, helperText, instructions, input, connectedAs }: KeyFormProps) {
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
    <Stack spacing={2}>
      {integrations.isPending && <Typography color="text.secondary">Loading…</Typography>}
      {integrations.isError && <Alert severity="error">{errorMessage(integrations.error)}</Alert>}

      {integrations.isSuccess && connected && !replacing && (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Typography sx={{ flexGrow: 1 }}>
            Connected ·{" "}
            {connectedAs ? (
              connectedAs(status?.keyHint ?? "")
            ) : (
              <>
                key ending in <code>{status?.keyHint}</code>
              </>
            )}
          </Typography>
          <Button onClick={() => setReplacing(true)}>Replace key</Button>
          <Button color="error" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
            Disconnect
          </Button>
        </Stack>
      )}

      {integrations.isSuccess && showForm && (
        <Stack component="form" spacing={2} onSubmit={handleSubmit}>
          {instructions}
          {input ? (
            input(setApiKey)
          ) : (
            <TextField
              label={`${name} API key`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              helperText={helperText}
              autoComplete="off"
              required
            />
          )}
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
  );
}

type PostgresConnection = { host: string; port: string; database: string; user: string; password: string; ssl: string };

const SSL_MODES = [
  { value: "no-verify", label: "On, without checking the certificate", help: "Heroku and most hosted databases" },
  { value: "verify-full", label: "On, checking the certificate", help: "The server's certificate is from a trusted authority" },
  { value: "disable", label: "Off", help: "A database on this machine or a private network" },
];

// The connection string the fields make: the user, password and database encoded, the
// SSL mode always set. Empty until the required fields are filled.
function postgresUrl({ host, port, database, user, password, ssl }: PostgresConnection) {
  if (!host.trim() || !database.trim() || !user.trim()) return "";
  const auth = `${encodeURIComponent(user.trim())}${password ? `:${encodeURIComponent(password)}` : ""}`;
  return `postgres://${auth}@${host.trim()}:${port.trim() || "5432"}/${encodeURIComponent(database.trim())}?sslmode=${ssl}`;
}

// A connection string split into the fields, e.g. one pasted from Heroku; null if it isn't one.
function parsePostgresUrl(text: string): PostgresConnection | null {
  const match = text.trim().match(/^postgres(?:ql)?:\/\/([^:@/]*)(?::([^@/]*))?@([^:/?]+)(?::(\d+))?\/([^?]*)(?:\?(.*))?$/);
  if (!match) return null;
  const [, user = "", password = "", host = "", port = "", database = "", query = ""] = match;
  const sslmode = new URLSearchParams(query).get("sslmode");
  return {
    host,
    port: port || "5432",
    database: decodeURIComponent(database),
    user: decodeURIComponent(user),
    password: decodeURIComponent(password),
    // Kept only when it's one zini offers: require would fail on Heroku's certificate.
    ssl: SSL_MODES.some((mode) => mode.value === sslmode) ? sslmode! : "no-verify",
  };
}

// The database's host, port, name, user, password and SSL, built into a connection
// string as they change, so it's never written by hand. Pasting a whole connection
// string into Host fills them all.
function PostgresFields({ onChange }: { onChange: (url: string) => void }) {
  const [fields, setFields] = useState<PostgresConnection>({
    host: "",
    port: "5432",
    database: "",
    user: "",
    password: "",
    ssl: "no-verify",
  });
  function update(next: PostgresConnection) {
    setFields(next);
    onChange(postgresUrl(next));
  }
  const field = (key: keyof PostgresConnection) => ({
    value: fields[key],
    onChange: (e: { target: { value: string } }) => update({ ...fields, [key]: e.target.value }),
    autoComplete: "off",
    size: "small" as const,
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5}>
        <TextField
          {...field("host")}
          label="Host"
          placeholder="ec2-…compute-1.amazonaws.com"
          helperText="Or paste a whole postgres:// URL here to fill everything in."
          required
          sx={{ flex: 1 }}
          onChange={(e) => {
            const parsed = parsePostgresUrl(e.target.value);
            update(parsed ?? { ...fields, host: e.target.value });
          }}
        />
        <TextField {...field("port")} label="Port" sx={{ width: 100 }} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
      </Stack>
      <TextField {...field("database")} label="Database" required />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField {...field("user")} label="User" placeholder="zini_readonly" required sx={{ flex: 1 }} />
        <TextField {...field("password")} label="Password" type="password" sx={{ flex: 1 }} />
      </Stack>
      <TextField {...field("ssl")} select label="SSL" helperText={SSL_MODES.find((mode) => mode.value === fields.ssl)?.help}>
        {SSL_MODES.map((mode) => (
          <MenuItem key={mode.value} value={mode.value}>
            {mode.label}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

// A service account's JSON key, pasted or picked as the file Google downloads.
function ServiceAccountKeyField({ onChange }: { onChange: (key: string) => void }) {
  const [key, setKey] = useState("");
  function update(next: string) {
    setKey(next);
    onChange(next.trim());
  }

  return (
    <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
      <TextField
        label="Service account key (JSON)"
        value={key}
        onChange={(e) => update(e.target.value)}
        placeholder='{ "type": "service_account", … }'
        multiline
        minRows={4}
        maxRows={8}
        required
        fullWidth
        autoComplete="off"
        slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: "monospace", fontSize: 12 } } }}
      />
      <Button component="label" size="small">
        Choose key file
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            void e.target.files?.[0]?.text().then(update);
            e.target.value = "";
          }}
        />
      </Button>
    </Stack>
  );
}

// A service zini connects to, shown as a row that opens a dialog with its settings.
type Service = { name: string; icon: SvgIconComponent; description: string; settings: ReactNode };

function ConnectionChip({ connected }: { connected: boolean | undefined }) {
  if (connected === undefined) return null;
  return (
    <Chip
      size="small"
      variant="outlined"
      color={connected ? "success" : "default"}
      label={connected ? "Connected" : "Not connected"}
    />
  );
}

function ServiceDialog({ service, onClose }: { service: Service | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(service)} onClose={onClose} maxWidth="sm" fullWidth>
      {service && (
        <>
          <IconDialogTitle icon={service.icon}>{service.name}</IconDialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <DialogContentText>{service.description}</DialogContentText>
              {service.settings}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

const CONNECTIONS: Record<"linear" | "github" | "postgres" | "googleDrive", Service> = {
  linear: {
    name: "Linear",
    icon: LinearIcon,
    description: "Your issues: the Project Lead manages them and Forges implement them.",
    settings: <KeyForm provider="linear" name="Linear" helperText="Create a personal API key in your Linear settings." />,
  },
  github: {
    name: "GitHub",
    icon: GitHubIcon,
    description: "Your code: agents clone the repo, push branches and open pull requests.",
    settings: (
      <KeyForm
        provider="github"
        name="GitHub"
        helperText="Paste the token here."
        instructions={
          <Box component="ol" sx={{ m: 0, pl: 3, typography: "body2", "& li + li": { mt: 0.5 } }}>
            <li>
              Create a fine-grained token at{" "}
              <Link href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
                github.com/settings/personal-access-tokens
              </Link>
              .
            </li>
            <li>Under Repository access, select your repo.</li>
            <li>Under Permissions, set Contents and Pull requests to Read and write.</li>
          </Box>
        }
      />
    ),
  },
  postgres: {
    name: "Postgres database",
    icon: PostgresIcon,
    description: "Optional: lets the Project Lead query your production PostgreSQL database, read-only.",
    settings: (
      <KeyForm
        provider="postgres"
        name="Postgres database"
        input={(onChange) => <PostgresFields onChange={onChange} />}
        connectedAs={(hint) => (
          <>
            as <code>{hint}</code>
          </>
        )}
        instructions={
          <Stack spacing={1.5}>
            <Typography variant="body2">
              Connect as a database user that can only read. zini also runs every query in a read-only transaction that&apos;s
              rolled back, but the user is what guarantees nothing can be changed. For example:
            </Typography>
            <Box
              component="pre"
              sx={{ m: 0, p: 1.5, borderRadius: 1, bgcolor: "background.default", fontSize: 12, overflowX: "auto" }}
            >
              {`CREATE ROLE zini_readonly LOGIN PASSWORD '…';
GRANT pg_read_all_data TO zini_readonly;
ALTER ROLE zini_readonly SET default_transaction_read_only = on;`}
            </Box>
            <Typography variant="body2" color="text.secondary">
              Rows the Project Lead reads are sent to its model provider. To keep some tables out, grant SELECT on the tables it
              may read instead of pg_read_all_data. On Heroku, create a credential with heroku pg:credentials:create and grant it
              SELECT; heroku pg:credentials:url shows its details.
            </Typography>
          </Stack>
        }
      />
    ),
  },
  googleDrive: {
    name: "Google Drive",
    icon: GoogleDriveIcon,
    description: "Optional: lets the Project Lead search and read the Drive files you share with it, read-only.",
    settings: (
      <KeyForm
        provider="googleDrive"
        name="Google Drive"
        input={(onChange) => <ServiceAccountKeyField onChange={onChange} />}
        connectedAs={(hint) => (
          <>
            as <code>{hint}</code>. Share folders with this email for the Project Lead to see them.
          </>
        )}
        instructions={
          <Stack spacing={1.5}>
            <Box component="ol" sx={{ m: 0, pl: 3, typography: "body2", "& li + li": { mt: 0.5 } }}>
              <li>
                In the{" "}
                <Link href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">
                  Google Cloud console
                </Link>
                , create or pick a project and enable the Google Drive API.
              </li>
              <li>Under IAM &amp; Admin → Service accounts, create a service account. It needs no roles.</li>
              <li>On its Keys tab, add a JSON key and paste the downloaded file below.</li>
              <li>
                In Google Drive, share the folders the Project Lead may read with the service account&apos;s email, as Viewer. For
                a shared drive, add it as a member instead.
              </li>
            </Box>
            <Typography variant="body2" color="text.secondary">
              The Project Lead sees only what&apos;s shared with that email, and files it reads are sent to its model provider. On
              Google Workspace, sharing with it needs sharing outside your organization to be allowed.
            </Typography>
          </Stack>
        }
      />
    ),
  },
};

const CONNECTION_IDS = Object.keys(CONNECTIONS) as (keyof typeof CONNECTIONS)[];

function ConnectionsCard() {
  const integrations = useIntegrations();
  const [open, setOpen] = useState<keyof typeof CONNECTIONS | null>(null);

  return (
    <Card variant="outlined">
      <List disablePadding>
        {CONNECTION_IDS.map((id, i) => (
          <SettingRow
            key={id}
            icon={CONNECTIONS[id].icon}
            name={CONNECTIONS[id].name}
            description={CONNECTIONS[id].description}
            onClick={() => setOpen(id)}
            status={<ConnectionChip connected={integrations.data?.[id]?.connected} />}
            divider={i < CONNECTION_IDS.length - 1}
          />
        ))}
      </List>
      {integrations.isError && (
        <Alert severity="error" sx={{ m: 2 }}>
          {errorMessage(integrations.error)}
        </Alert>
      )}
      <ServiceDialog service={open && CONNECTIONS[open]} onClose={() => setOpen(null)} />
    </Card>
  );
}

// The repo the agents work on: a row showing it, opening a dialog to set or switch it.
function RepositoryRow() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const repo = settings.data?.githubRepo;

  return (
    <>
      <SettingRow
        icon={GitHubIcon}
        name="GitHub repository"
        description="The repo your Linear issues are about."
        onClick={() => setOpen(true)}
        divider={Boolean(repo)}
        status={
          settings.isSuccess &&
          (repo ? (
            <Chip size="small" variant="outlined" label={repo} sx={{ maxWidth: 240 }} />
          ) : (
            <Chip size="small" variant="outlined" color="warning" label="Not set" />
          ))
        }
      />
      {settings.isError && (
        <Alert severity="error" sx={{ m: 2 }}>
          {errorMessage(settings.error)}
        </Alert>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        {open && <RepositoryForm current={repo ?? ""} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

// Mounted only while its dialog is open. Switching to another repo deletes every
// workspace, so it warns as soon as the name differs, then asks to confirm.
function RepositoryForm({ current, onClose }: { current: string; onClose: () => void }) {
  const save = useSaveSettings();
  const [repo, setRepo] = useState(current);
  const [confirming, setConfirming] = useState(false);
  const trimmed = repo.trim();
  const switching = Boolean(current) && trimmed.toLowerCase() !== current.toLowerCase();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (switching && !confirming) {
      save.reset();
      setConfirming(true);
      return;
    }
    save.mutate(switching ? { githubRepo: trimmed, confirmWorkspaceDeletion: true } : { githubRepo: trimmed }, {
      onSuccess: onClose,
    });
  }

  if (confirming)
    return (
      <Box component="form" onSubmit={handleSubmit}>
        <DialogTitle>Delete workspaces and switch repository?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Switching to {trimmed} permanently deletes all workspaces, their Docker containers, volumes, Forge history and logs.
            Uncommitted changes and unpushed commits will be lost. This cannot be undone.
          </DialogContentText>
          {save.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errorMessage(save.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={save.isPending} onClick={() => setConfirming(false)}>
            Back
          </Button>
          <Button type="submit" color="error" variant="contained" loading={save.isPending}>
            Delete workspaces and switch
          </Button>
        </DialogActions>
      </Box>
    );

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <IconDialogTitle icon={GitHubIcon}>GitHub repository</IconDialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            The repo your Linear issues are about. Agents clone it into their workspaces.
            {current && (
              <>
                {" "}
                Currently{" "}
                <Link href={`https://github.com/${current}`} target="_blank" rel="noreferrer">
                  {current}
                </Link>
                .
              </>
            )}
          </DialogContentText>
          <TextField
            label="Repository"
            placeholder="owner/name"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            helperText="As owner/name. Connect GitHub first; the token needs access to this repo."
            autoComplete="off"
            autoFocus
            required
            disabled={save.isPending}
            sx={{ mt: 1 }}
          />
          {switching && (
            <Alert severity="warning">
              Switching repositories deletes all workspaces, their Docker containers and volumes, and Forge history and logs.
              Pause running Forges and stop app launches first.
            </Alert>
          )}
          {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" loading={save.isPending} disabled={!trimmed || trimmed === current}>
          {switching ? "Switch…" : "Save"}
        </Button>
      </DialogActions>
    </Box>
  );
}

// Sign in with ChatGPT, to run models on your ChatGPT plan. Its callback goes to this
// machine's 127.0.0.1, so the sign-in only works in a browser on the computer running
// zini.
function ChatGptSettings() {
  const status = useChatGpt();
  const signIn = useChatGptSignIn();
  const signOut = useChatGptSignOut();
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  return (
    <Stack spacing={2}>
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
        status.isSuccess &&
        (local ? (
          <Stack direction="row">
            <Button variant="contained" loading={signIn.isPending} onClick={() => signIn.mutate()}>
              Sign in with ChatGPT
            </Button>
          </Stack>
        ) : (
          <Alert severity="info">Sign in from a browser on the computer running zini.</Alert>
        ))
      )}
    </Stack>
  );
}

const PROVIDERS: Record<ModelProvider, Service> = {
  openrouter: {
    name: "OpenRouter",
    icon: OpenRouterIcon,
    description: "Models from many labs, paid per use with an OpenRouter API key.",
    settings: <KeyForm provider="openrouter" name="OpenRouter" helperText="Create an API key at openrouter.ai/keys." />,
  },
  chatgpt: {
    name: "ChatGPT plan",
    icon: OpenAIIcon,
    description: "OpenAI models on your ChatGPT Plus or Pro plan. Usage counts against your plan's limits.",
    settings: <ChatGptSettings />,
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS) as ModelProvider[];

type Agent = {
  name: string;
  description: string;
  icon: SvgIconComponent;
  provider: "projectLeadProvider" | "forgeProvider" | "openwikiProvider";
  model: "projectLeadModel" | "forgeModel" | "openwikiModel";
  helperText: string;
};

const AGENTS: Agent[] = [
  {
    name: "Project Lead",
    description: "Plans the work with you in chat and manages your Linear issues.",
    icon: SupportAgentIcon,
    provider: "projectLeadProvider",
    model: "projectLeadModel",
    helperText: "An OpenRouter model ID that supports tool calling.",
  },
  {
    name: "Forge",
    description: "Implements an issue in its workspace, from plan to pull request.",
    icon: ConstructionIcon,
    provider: "forgeProvider",
    model: "forgeModel",
    helperText: "An OpenRouter model ID that supports tool calling.",
  },
  {
    name: "OpenWiki",
    description: "Writes the repo's wiki docs.",
    icon: DescriptionIcon,
    provider: "openwikiProvider",
    model: "openwikiModel",
    helperText: "An OpenRouter model ID.",
  },
];

// A clickable row that opens a dialog: icon, name and description, then a status on the right.
function SettingRow({
  icon: Icon,
  name,
  description,
  status,
  onClick,
  divider,
}: {
  icon: SvgIconComponent;
  name: string;
  description: string;
  status: ReactNode;
  onClick: () => void;
  divider?: boolean;
}) {
  return (
    <ListItemButton onClick={onClick} divider={divider} sx={{ gap: 2, px: 2 }}>
      <ListItemIcon sx={{ minWidth: 0 }}>
        <Icon />
      </ListItemIcon>
      <ListItemText primary={name} secondary={description} />
      {status}
      <ChevronRightIcon color="action" />
    </ListItemButton>
  );
}

// A dialog's title, with the icon of what it's about.
function IconDialogTitle({ icon, children }: { icon: SvgIconComponent; children: ReactNode }) {
  return (
    <DialogTitle component="div">
      <CardTitle icon={icon}>{children}</CardTitle>
    </DialogTitle>
  );
}

// An agent's provider and model, saved together. Mounted only while its dialog is open,
// so unsaved changes are dropped when it closes.
function AgentModelForm({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const chatGpt = useChatGpt();
  const [drafts, setDrafts] = useState<Partial<Record<keyof Settings, string>>>({});
  const provider = (drafts[agent.provider] ?? settings.data?.[agent.provider] ?? "openrouter") as ModelProvider;
  const model = drafts[agent.model] ?? settings.data?.[agent.model] ?? "";
  const models = useChatGptModels(provider === "chatgpt" && Boolean(chatGpt.data?.connected));
  const formId = useId();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate(drafts, { onSuccess: onClose });
  }

  return (
    <>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{agent.description}</DialogContentText>
          {settings.isError && <Alert severity="error">{errorMessage(settings.error)}</Alert>}
          {settings.isSuccess && (
            <Stack component="form" id={formId} spacing={2} onSubmit={handleSubmit} sx={{ pt: 1 }}>
              <TextField
                select
                label="Provider"
                value={provider}
                // A model id belongs to its provider, so switching starts the model afresh.
                onChange={(e) => setDrafts((d) => ({ ...d, [agent.provider]: e.target.value, [agent.model]: "" }))}
              >
                {PROVIDER_IDS.map((id) => {
                  const { name, icon: Icon } = PROVIDERS[id];
                  return (
                    <MenuItem key={id} value={id}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                        <Icon fontSize="small" />
                        <span>{name}</span>
                      </Stack>
                    </MenuItem>
                  );
                })}
              </TextField>
              {provider === "openrouter" ? (
                <TextField
                  label="Model"
                  value={model}
                  onChange={(e) => setDrafts((d) => ({ ...d, [agent.model]: e.target.value }))}
                  placeholder="anthropic/claude-sonnet-5"
                  helperText={`${agent.helperText} It must accept text and image inputs.`}
                  autoComplete="off"
                  required
                />
              ) : !chatGpt.data?.connected ? (
                <Alert severity="info">Sign in with ChatGPT under Providers to choose one of your plan&apos;s models.</Alert>
              ) : (
                <TextField
                  select
                  label="Model"
                  value={models.data?.some((m) => m.slug === model) ? model : ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [agent.model]: e.target.value }))}
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
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" form={formId} variant="contained" loading={save.isPending} disabled={!drafts[agent.model]}>
          Save
        </Button>
      </DialogActions>
    </>
  );
}

// The providers models run on and the model each agent uses, each opening a dialog
// with its settings so the page stays short.
function ModelsCard() {
  const integrations = useIntegrations();
  const chatGpt = useChatGpt();
  const settings = useSettings();
  const [openProvider, setOpenProvider] = useState<ModelProvider | null>(null);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const connected: Record<ModelProvider, boolean | undefined> = {
    openrouter: integrations.data?.openrouter.connected,
    chatgpt: chatGpt.data?.connected,
  };
  const subheader = (title: string) => (
    <ListSubheader disableSticky sx={{ bgcolor: "transparent", lineHeight: 2.5, pt: 1 }}>
      {title}
    </ListSubheader>
  );

  return (
    <Card variant="outlined">
      <List disablePadding subheader={subheader("Providers")}>
        {PROVIDER_IDS.map((id) => (
          <SettingRow
            key={id}
            icon={PROVIDERS[id].icon}
            name={PROVIDERS[id].name}
            description={PROVIDERS[id].description}
            onClick={() => setOpenProvider(id)}
            status={<ConnectionChip connected={connected[id]} />}
          />
        ))}
      </List>
      <Divider />
      <List disablePadding subheader={subheader("Agents")}>
        {AGENTS.map((agent) => {
          const provider = (settings.data?.[agent.provider] ?? "openrouter") as ModelProvider;
          const model = settings.data?.[agent.model];
          const ProviderIcon = PROVIDERS[provider].icon;
          return (
            <SettingRow
              key={agent.name}
              icon={agent.icon}
              name={agent.name}
              description={agent.description}
              onClick={() => setOpenAgent(agent)}
              status={
                settings.isSuccess &&
                (model ? (
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<ProviderIcon />}
                    label={model}
                    title={`${model} on ${PROVIDERS[provider].name}`}
                    sx={{ maxWidth: 240 }}
                  />
                ) : (
                  <Chip size="small" variant="outlined" color="warning" label="No model" />
                ))
              }
            />
          );
        })}
      </List>
      <ServiceDialog service={openProvider && PROVIDERS[openProvider]} onClose={() => setOpenProvider(null)} />
      <Dialog open={Boolean(openAgent)} onClose={() => setOpenAgent(null)} maxWidth="sm" fullWidth>
        {openAgent && (
          <>
            <IconDialogTitle icon={openAgent.icon}>{openAgent.name} model</IconDialogTitle>
            <AgentModelForm agent={openAgent} onClose={() => setOpenAgent(null)} />
          </>
        )}
      </Dialog>
    </Card>
  );
}

// A titled group of settings cards.
function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Stack component="section" spacing={2}>
      <div>
        <Typography variant="h5" component="h2">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </div>
      {children}
    </Stack>
  );
}

// A row with its control on the right, for settings changed in place: icon, name and
// description, then the control.
function ControlRow({
  icon: Icon,
  name,
  description,
  control,
  divider,
}: {
  icon: SvgIconComponent;
  name: string;
  description: string;
  control: ReactNode;
  divider?: boolean;
}) {
  return (
    <ListItem divider={divider} sx={{ gap: 2, px: 2, py: 1.5 }}>
      <ListItemIcon sx={{ minWidth: 0 }}>
        <Icon />
      </ListItemIcon>
      <ListItemText primary={name} secondary={description} />
      <Box sx={{ flexShrink: 0 }}>{control}</Box>
    </ListItem>
  );
}

// Conductor and appearance, each changed in place: the conductor's switch saves at
// once, and setMode also saves the theme in localStorage, so it survives reloads.
function GeneralCard() {
  const settings = useSettings();
  const save = useSaveSettings();
  const { mode, setMode } = useColorScheme();

  return (
    <Card variant="outlined">
      <List disablePadding>
        <ControlRow
          icon={AutoModeIcon}
          name="Conductor"
          description="Automatically starts Forges for unstarted Linear issues. Turning it off stops new starts; running Forges continue."
          divider
          control={
            <Switch
              checked={settings.data?.conductorEnabled !== "false"}
              disabled={!settings.isSuccess || save.isPending}
              onChange={(_event, checked) => save.mutate({ conductorEnabled: String(checked) })}
              slotProps={{ input: { "aria-label": "Enable conductor" } }}
            />
          }
        />
        <ControlRow
          icon={PaletteOutlinedIcon}
          name="Appearance"
          description="How zini looks on this browser."
          control={
            <ToggleButtonGroup
              exclusive
              size="small"
              value={mode ?? "dark"}
              onChange={(_e, value: "light" | "dark" | null) => value && setMode(value)}
              aria-label="Theme"
            >
              <ToggleButton value="dark" sx={{ gap: 0.75, px: 1.5 }}>
                <DarkModeOutlinedIcon fontSize="small" />
                Dark
              </ToggleButton>
              <ToggleButton value="light" sx={{ gap: 0.75, px: 1.5 }}>
                <LightModeOutlinedIcon fontSize="small" />
                Light
              </ToggleButton>
            </ToggleButtonGroup>
          }
        />
      </List>
      {settings.isError && (
        <Alert severity="error" sx={{ m: 2 }}>
          {errorMessage(settings.error)}
        </Alert>
      )}
      {save.isError && (
        <Alert severity="error" sx={{ m: 2 }}>
          {errorMessage(save.error)}
        </Alert>
      )}
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
      <Stack spacing={5}>
        <Section
          title="Connections"
          description="The services zini works with: your issues in Linear, your code on GitHub, and optionally your Postgres database and Google Drive."
        >
          <ConnectionsCard />
        </Section>
        <Section title="Models" description="Where the agents' models run, and which model each agent uses.">
          <ModelsCard />
        </Section>
        <Section title="Repository" description="The repo the agents work on, and how its app runs in a workspace.">
          <Card variant="outlined">
            <List disablePadding>
              <RepositoryRow />
              {settings.data?.githubRepo && (
                <DevelopmentEnvironmentRow key={settings.data.githubRepo} repository={settings.data.githubRepo} />
              )}
            </List>
          </Card>
        </Section>
        <Section title="General" description="Automation and how zini looks.">
          <GeneralCard />
        </Section>
      </Stack>
    </Container>
  );
}

export default SettingsPage;
