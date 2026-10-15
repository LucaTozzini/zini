import { useState, type FormEvent } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { errorMessage } from "../api/client.ts";
import {
  useOpenWikiStatus,
  useRefreshServing,
  useSearchWiki,
  useServeStatus,
  useStartScan,
  useWikiPage,
  useWikiPages,
} from "../api/openwiki.ts";
import MarkdownText from "../components/MarkdownText.tsx";

const shortHash = (hash: string | null) => (hash ? hash.slice(0, 7) : "—");

// No wiki on main yet: explain, and offer to generate one. Also the landing state
// when the last scan failed, with its error and a retry.
function EmptyDocs({
  failedError,
  onScan,
  scanning,
  scanError,
}: {
  failedError: string | null;
  onScan: () => void;
  scanning: boolean;
  scanError: string | null;
}) {
  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Docs
      </Typography>
      <Stack spacing={2}>
        <Typography color="text.secondary">
          Generate architecture docs for the connected repo. Zini researches the
          codebase and writes a linked wiki, then opens a pull request with it.
          The Project Lead and the Forge&apos;s planner use the wiki to orient
          themselves before planning.
        </Typography>
        {failedError && (
          <Alert severity="error">The last scan failed: {failedError}</Alert>
        )}
        {scanError && <Alert severity="error">{scanError}</Alert>}
        <Stack direction="row">
          <Button
            variant="contained"
            loading={scanning}
            disabled={scanning}
            onClick={onScan}
          >
            {failedError ? "Try again" : "Generate docs"}
          </Button>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          The scan runs in the background and can take a while on a big repo.
          Docs are generated with the OpenWiki model from Settings.
        </Typography>
      </Stack>
    </Container>
  );
}

// A scan is going and there's no wiki to show yet.
function GeneratingDocs({
  startedAt,
  ignoreUsed,
}: {
  startedAt: string | null;
  ignoreUsed: "repo" | "default" | null;
}) {
  return (
    <Container maxWidth="md" sx={{ my: 5 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Docs
      </Typography>
      <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress size={24} />
          <Typography>Generating docs…</Typography>
        </Stack>
        {startedAt && (
          <Typography variant="body2" color="text.secondary">
            Started {new Date(startedAt).toLocaleString()}
          </Typography>
        )}
        {ignoreUsed && (
          <Typography variant="body2" color="text.secondary">
            {ignoreUsed === "repo"
              ? "Using the repo's .openwikiignore."
              : "Using zini's default ignore rules."}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          This page updates when the scan finishes.
        </Typography>
      </Stack>
    </Container>
  );
}

// The served wiki checkout vs main, with a manual refresh.
function ServeStatusRow() {
  const serve = useServeStatus();
  const refresh = useRefreshServing();
  if (!serve.data) return null;
  const { commit, mainCommit } = serve.data;
  const upToDate = Boolean(commit && mainCommit && commit === mainCommit);
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
    >
      <Typography variant="body2" color="text.secondary">
        Served {shortHash(commit)} · main {shortHash(mainCommit)}
        {upToDate ? " · up to date" : " · behind main"}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        loading={refresh.isPending}
        disabled={upToDate || refresh.isPending || !mainCommit}
        onClick={() => refresh.mutate()}
      >
        Refresh served docs
      </Button>
      {refresh.isError && (
        <Typography variant="body2" color="error">
          {errorMessage(refresh.error)}
        </Typography>
      )}
    </Stack>
  );
}

// Search-only Q&A over the wiki: ranked sections, no model call. Clicking a result
// opens its page.
function WikiSearch({ onOpenPage }: { onOpenPage: (page: string) => void }) {
  const [query, setQuery] = useState("");
  const search = useSearchWiki();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) search.mutate({ query: q });
  }

  return (
    <Stack spacing={1}>
      <Stack component="form" direction="row" spacing={1} onSubmit={handleSubmit}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search the docs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search the docs"
        />
        <Button
          type="submit"
          variant="outlined"
          loading={search.isPending}
          disabled={!query.trim()}
        >
          Search
        </Button>
      </Stack>
      {search.isError && (
        <Alert severity="error">{errorMessage(search.error)}</Alert>
      )}
      {search.isSuccess && search.data.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No sections matched.
        </Typography>
      )}
      {search.isSuccess && search.data.length > 0 && (
        <List disablePadding>
          {search.data.map((r, i) => (
            <ListItemButton
              key={`${r.page}#${r.section}#${i}`}
              onClick={() => {
                onOpenPage(r.page);
                search.reset();
                setQuery("");
              }}
              sx={{ borderRadius: 1 }}
            >
              <ListItemText
                primary={r.section || r.page}
                secondary={
                  <>
                    <Typography
                      component="span"
                      variant="body2"
                      color="text.secondary"
                    >
                      {r.page}
                    </Typography>
                    {r.excerpt && ` — ${r.excerpt}`}
                  </>
                }
                slotProps={{
                  secondary: {
                    sx: {
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    },
                  },
                }}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </Stack>
  );
}

function ReadyDocs({
  pageList,
  pullRequestUrl,
  running,
  onScan,
  scanning,
  scanError,
}: {
  pageList: string[];
  pullRequestUrl: string | null;
  running: boolean;
  onScan: () => void;
  scanning: boolean;
  scanError: string | null;
}) {
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const activePage = selectedPage ?? pageList[0] ?? null;
  const page = useWikiPage(activePage);

  return (
    <Container maxWidth="lg" sx={{ my: 4 }}>
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
        >
          <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
            Docs
          </Typography>
          {pullRequestUrl && (
            <Link href={pullRequestUrl} target="_blank" rel="noreferrer">
              View docs PR
            </Link>
          )}
          <Button
            variant="outlined"
            size="small"
            loading={scanning}
            disabled={running || scanning}
            onClick={onScan}
          >
            Regenerate
          </Button>
        </Stack>
        {running && (
          <Alert severity="info">
            Regenerating docs in the background — this page keeps showing the
            current version until the new one lands.
          </Alert>
        )}
        {scanError && <Alert severity="error">{scanError}</Alert>}
        <ServeStatusRow />
        <WikiSearch onOpenPage={setSelectedPage} />
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ alignItems: "flex-start" }}
        >
          <Card
            variant="outlined"
            sx={{ width: { xs: "100%", md: 280 }, flexShrink: 0 }}
          >
            <List disablePadding sx={{ maxHeight: 600, overflow: "auto" }}>
              {pageList.map((p) => (
                <ListItemButton
                  key={p}
                  selected={p === activePage}
                  onClick={() => setSelectedPage(p)}
                  sx={{ borderRadius: 1 }}
                >
                  <ListItemText
                    primary={p}
                    slotProps={{
                      primary: {
                        variant: "body2",
                        sx: { overflowWrap: "anywhere" },
                      },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Card>
          <Card variant="outlined" sx={{ flex: 1, minWidth: 0 }}>
            <CardContent>
              {page.isPending && (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                  <CircularProgress size={24} />
                </Box>
              )}
              {page.isError && (
                <Alert severity="error">{errorMessage(page.error)}</Alert>
              )}
              {page.data !== undefined && (
                <MarkdownText>{page.data}</MarkdownText>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Stack>
    </Container>
  );
}

function DocsPage() {
  const status = useOpenWikiStatus();
  const pages = useWikiPages();
  const scan = useStartScan();

  function handleScan() {
    scan.reset();
    scan.mutate();
  }
  const scanning = scan.isPending;
  const scanError = scan.isError ? errorMessage(scan.error) : null;

  if (status.isPending || pages.isPending) {
    return (
      <Container maxWidth="md" sx={{ my: 5 }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Container>
    );
  }
  if (status.isError) {
    return (
      <Container maxWidth="md" sx={{ my: 5 }}>
        <Alert severity="error">{errorMessage(status.error)}</Alert>
      </Container>
    );
  }

  const pageList = [...(pages.data ?? [])].sort((a, b) => a.localeCompare(b));
  const hasWiki = pageList.length > 0;
  const running = status.data?.state === "running";

  if (!hasWiki) {
    if (running) {
      return (
        <GeneratingDocs
          startedAt={status.data?.startedAt ?? null}
          ignoreUsed={status.data?.ignoreUsed ?? null}
        />
      );
    }
    return (
      <EmptyDocs
        failedError={
          status.data?.state === "failed"
            ? (status.data.error ?? "Unknown error")
            : null
        }
        onScan={handleScan}
        scanning={scanning || running}
        scanError={scanError}
      />
    );
  }

  return (
    <ReadyDocs
      pageList={pageList}
      pullRequestUrl={status.data?.pullRequestUrl ?? null}
      running={running}
      onScan={handleScan}
      scanning={scanning}
      scanError={scanError}
    />
  );
}

export default DocsPage;
