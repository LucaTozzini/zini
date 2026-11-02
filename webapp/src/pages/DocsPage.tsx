import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CloseIcon from "@mui/icons-material/Close";
import CommitIcon from "@mui/icons-material/Commit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import SearchIcon from "@mui/icons-material/Search";
import SyncIcon from "@mui/icons-material/Sync";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PullRequest } from "shared";
import { errorMessage } from "../api/client.ts";
import {
  type OpenWikiProgress,
  type OpenWikiSearchResult,
  useDocsPullRequest,
  useOpenWikiStatus,
  useRefreshServing,
  useSearchWiki,
  useServeStatus,
  useStartScan,
  useWikiPage,
  useWikiPages,
} from "../api/openwiki.ts";
import OpenWikiIcon from "../components/icons/OpenWikiIcon.tsx";
import MarkdownText, { type LinkTarget } from "../components/MarkdownText.tsx";
import { useProject } from "../api/projects.ts";
import { useProjectId, useProjectPath } from "../hooks/useProject.ts";

const shortHash = (hash: string | null) => (hash ? hash.slice(0, 7) : "—");

// "concepts/ai-quoting.md" → "Ai quoting"; a folder's index.md is its "Overview".
function pageLabel(path: string) {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  if (name === "index") return "Overview";
  const words = name.replace(/[-_]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const folderLabel = (folder: string) => folder.split("/").map(pageLabel).join(" / ");
const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const isIndex = (path: string) => path === "index.md" || path.endsWith("/index.md");

// The docs route for a wiki page, under the project's docs (base): "architecture/index.md"
// → "<base>/architecture/", "quickstart.md" → "<base>/quickstart".
const docsUrl = (base: string, path: string) => `${base}/${path.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "")}`;

// The wiki page at a path, which may leave out ".md" or point at a folder (its
// index.md): what a docs route or a wiki link names. null if there's none.
function findPage(path: string, pages: string[]) {
  const folder = path && !path.endsWith("/") ? `${path}/` : path;
  return [path, `${path}.md`, `${folder}index.md`].find((candidate) => pages.includes(candidate)) ?? null;
}

// "a/b/../c/./d" → "a/c/d", keeping a trailing slash; null if it climbs above the root.
function normalizePath(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/") + (path.endsWith("/") && parts.length ? "/" : "");
}

// Where a link in a wiki page goes. A link to another wiki page opens it here; one to
// a file in the repo (the wiki lives in its openwiki/ folder) opens it on GitHub.
// Relative links are from the page's folder. Links starting with "/" are from the
// wiki's root, or the repo's when no wiki page is there. URLs and #anchors are kept.
function resolveWikiLink(href: string, from: string, pages: string[], repo: string | undefined, base: string): LinkTarget {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) return undefined;
  const hashAt = href.indexOf("#");
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const absolute = path.startsWith("/");
  const wikiPath = normalizePath(absolute ? path.replace(/^\/openwiki\//, "/") : `${folderOf(from)}/${path}`);
  const page = wikiPath !== null ? findPage(wikiPath, pages) : null;
  if (page) return { to: docsUrl(base, page) + hash };
  const repoPath = normalizePath(absolute ? path : `openwiki/${folderOf(from)}/${path}`);
  return repo && repoPath ? { href: `https://github.com/${repo}/blob/HEAD/${repoPath}${hash}` } : undefined;
}

// The wiki's readable pages, grouped by folder: the root's first, then each folder's
// in order, each led by its index. openwiki's own files (dot-prefixed, e.g. .claims/)
// are left out.
function navSections(pages: string[]) {
  const docs = pages.filter((p) => p.endsWith(".md") && !p.split("/").some((part) => part.startsWith(".")));
  const folders = new Map<string, string[]>();
  for (const page of docs.length ? docs : pages) {
    folders.set(folderOf(page), [...(folders.get(folderOf(page)) ?? []), page]);
  }
  return [...folders.entries()]
    .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
    .map(([folder, folderPages]) => ({
      folder,
      pages: folderPages.sort((a, b) => Number(isIndex(b)) - Number(isIndex(a)) || a.localeCompare(b)),
    }));
}

// A docs state with no wiki to read: an icon, a heading and what to do next.
function DocsMessage({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Container maxWidth="sm" sx={{ my: { xs: 5, md: 10 } }}>
      <Stack spacing={2.5} sx={{ alignItems: "center", textAlign: "center" }}>
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 56,
            height: 56,
            borderRadius: 3,
            bgcolor: "action.selected",
            color: "primary.main",
            "& .MuiSvgIcon-root": { fontSize: 30 },
          }}
        >
          {icon}
        </Box>
        <Typography variant="h5" component="h1">
          {title}
        </Typography>
        {children}
      </Stack>
    </Container>
  );
}

// No wiki on main yet: explain, and offer to generate one. Also the landing state
// when the last scan failed, with its error and a retry. While a docs PR is open, the
// wiki is waiting on its merge, so opening it is the main action instead.
function EmptyDocs({
  failedError,
  onScan,
  scanning,
  scanError,
  pullRequest,
}: {
  failedError: string | null;
  onScan: () => void;
  scanning: boolean;
  scanError: string | null;
  pullRequest: UseQueryResult<PullRequest | null>;
}) {
  const open = pullRequest.data?.state === "open" ? pullRequest.data : null;
  return (
    <DocsMessage icon={<OpenWikiIcon />} title={open ? "Docs ready to merge" : "No docs yet"}>
      <Typography color="text.secondary">
        {open
          ? `The scan opened pull request #${open.number} with the wiki. Merge it, and the docs show up here.`
          : "Zini researches the connected repo, writes a linked architecture wiki, and opens a pull request with it. The Project Lead and the Forge's agents read it to orient themselves before planning."}
      </Typography>
      {failedError && (
        <Alert severity="error" sx={{ textAlign: "left", width: "100%" }}>
          The last scan failed: {failedError}
        </Alert>
      )}
      {scanError && (
        <Alert severity="error" sx={{ textAlign: "left", width: "100%" }}>
          {scanError}
        </Alert>
      )}
      {open ? (
        <Button variant="contained" href={open.url} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
          Open pull request
        </Button>
      ) : (
        <>
          <Button variant="contained" startIcon={<AutoAwesomeIcon />} loading={scanning} disabled={scanning} onClick={onScan}>
            {failedError ? "Try again" : "Generate docs"}
          </Button>
          <Typography variant="body2" color="text.secondary">
            The scan runs in the background and can take a while on a big repo. It uses the OpenWiki model from Settings.
          </Typography>
        </>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {open ? "Merged it?" : "Merged the docs PR?"}
        </Typography>
        <Button
          size="small"
          startIcon={<SyncIcon />}
          loading={pullRequest.isFetching}
          disabled={pullRequest.isFetching}
          onClick={() => pullRequest.refetch()}
        >
          Check again
        </Button>
      </Stack>
      {pullRequest.isError && (
        <Typography variant="body2" color="error">
          {errorMessage(pullRequest.error)}
        </Typography>
      )}
    </DocsMessage>
  );
}

// The scan's latest step, as one line.
function progressText(progress: OpenWikiProgress | null) {
  if (!progress) return null;
  if (progress.stage === "planning") return "Planning pages…";
  if (progress.stage === "generating") {
    const page = progress.page?.replace(/^\/openwiki\//, "") ?? "";
    return `Writing page ${progress.pageIndex} of ${progress.pageCount}: ${page}`;
  }
  if (progress.stage === "finalizing") return "Finalizing the wiki…";
  if (progress.stage === "publishing") return "Committing and opening the docs PR…";
  return progress.stage;
}

// A bar for the scan: filling up while it writes pages, moving otherwise.
function ScanProgress({ progress }: { progress: OpenWikiProgress | null }) {
  const percent =
    progress?.stage === "generating" && progress.pageIndex && progress.pageCount
      ? (progress.pageIndex / progress.pageCount) * 100
      : null;
  return (
    <Stack spacing={1} sx={{ width: "100%" }}>
      <LinearProgress
        variant={percent === null ? "indeterminate" : "determinate"}
        value={percent ?? undefined}
        sx={{ borderRadius: 1 }}
      />
      {progress && (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
          {progressText(progress)}
        </Typography>
      )}
    </Stack>
  );
}

// A scan is going and there's no wiki to show yet.
function GeneratingDocs({
  startedAt,
  ignoreUsed,
  progress,
}: {
  startedAt: string | null;
  ignoreUsed: "repo" | "default" | null;
  progress: OpenWikiProgress | null;
}) {
  return (
    <DocsMessage icon={<AutoAwesomeIcon />} title="Generating docs…">
      <ScanProgress progress={progress} />
      <Typography variant="body2" color="text.secondary">
        {startedAt && `Started ${new Date(startedAt).toLocaleString()}. `}
        {ignoreUsed && (ignoreUsed === "repo" ? "Using the repo's .openwikiignore. " : "Using zini's default ignore rules. ")}
        This page updates when the scan finishes.
      </Typography>
    </DocsMessage>
  );
}

// Which commit of main the docs come from, and a button to pull the latest.
function ServeStatus() {
  const serve = useServeStatus();
  const refresh = useRefreshServing();
  if (!serve.data) return null;
  const { commit, mainCommit } = serve.data;
  const upToDate = Boolean(commit && mainCommit && commit === mainCommit);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
      <Chip size="small" variant="outlined" icon={<CommitIcon />} label={`main @ ${shortHash(commit)}`} />
      <Typography variant="body2" color={upToDate ? "text.secondary" : "warning.main"}>
        {upToDate ? "Up to date" : `main is at ${shortHash(mainCommit)}`}
      </Typography>
      <Tooltip title="Pull latest main">
        <span>
          {/* Not disabled when up to date: main is as of zini's last fetch, and this fetches. */}
          <IconButton
            size="small"
            aria-label="Pull latest main"
            loading={refresh.isPending}
            disabled={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <SyncIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
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
function SearchResults({
  query,
  results,
  onOpenPage,
  onClose,
}: {
  query: string;
  results: OpenWikiSearchResult[];
  onOpenPage: (page: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <Stack direction="row" sx={{ alignItems: "center", px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No results"} for “{query}”
        </Typography>
        <Tooltip title="Close search">
          <IconButton size="small" aria-label="Close search" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      {results.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          No sections matched. Try other words.
        </Typography>
      ) : (
        <List disablePadding>
          {results.map((r, i) => (
            <ListItemButton key={`${r.page}#${r.section}#${i}`} divider onClick={() => onOpenPage(r.page)} sx={{ px: 2 }}>
              <ListItemText
                // Sections are slugs, e.g. "webhook-handling", so they're labelled like pages.
                primary={pageLabel(r.section || r.page)}
                secondary={
                  <>
                    <Typography component="span" variant="caption" color="primary" sx={{ display: "block" }}>
                      {folderOf(r.page) && `${folderLabel(folderOf(r.page))} › `}
                      {pageLabel(r.page)}
                    </Typography>
                    {r.excerpt}
                  </>
                }
                slotProps={{
                  secondary: {
                    sx: { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
                  },
                }}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </>
  );
}

// A link in the page's breadcrumb.
function CrumbLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link component={RouterLink} to={to} variant="caption" color="text.secondary" underline="hover">
      {children}
    </Link>
  );
}

// The wiki's pages, grouped by folder.
function PageNav({
  sections,
  activePage,
  onNavigate,
}: {
  sections: ReturnType<typeof navSections>;
  activePage: string | null;
  onNavigate: () => void;
}) {
  const docs = useProjectPath()("/docs");
  return (
    <Stack component="nav" aria-label="OpenWiki pages" spacing={1.5}>
      {sections.map(({ folder, pages }) => (
        <div key={folder}>
          {folder && (
            <Typography
              variant="caption"
              component="div"
              sx={{
                px: 1,
                pb: 0.5,
                color: "text.secondary",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {folderLabel(folder)}
            </Typography>
          )}
          <List disablePadding dense>
            {pages.map((p) => (
              <ListItemButton
                key={p}
                component={RouterLink}
                to={docsUrl(docs, p)}
                selected={p === activePage}
                onClick={onNavigate}
                title={p}
                sx={{ borderRadius: 1, py: 0.25, color: p === activePage ? "text.primary" : "text.secondary" }}
              >
                <ListItemText primary={pageLabel(p)} slotProps={{ primary: { variant: "body2", noWrap: true } }} />
              </ListItemButton>
            ))}
          </List>
        </div>
      ))}
    </Stack>
  );
}

function ReadyDocs({
  pageList,
  pullRequestUrl,
  running,
  progress,
  onScan,
  scanning,
  scanError,
}: {
  pageList: string[];
  pullRequestUrl: string | null;
  running: boolean;
  progress: OpenWikiProgress | null;
  onScan: () => void;
  scanning: boolean;
  scanError: string | null;
}) {
  const sections = navSections(pageList);
  const navPages = sections.flatMap((section) => section.pages);
  // The open page is in the URL (/docs/<page>), so the browser's back and forward move
  // between pages. /docs alone opens the wiki's index.
  const { "*": splat = "" } = useParams();
  const navigate = useNavigate();
  const activePage = splat ? findPage(splat, pageList) : navPages.includes("index.md") ? "index.md" : (navPages[0] ?? null);
  const page = useWikiPage(activePage);
  const repo = useProject(useProjectId()).data?.githubRepo;
  const docs = useProjectPath()("/docs");
  const resolveLink = useCallback(
    (href: string) => (activePage ? resolveWikiLink(href, activePage, pageList, repo, docs) : undefined),
    [activePage, pageList, repo, docs],
  );
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const search = useSearchWiki();
  const folder = activePage ? folderOf(activePage) : "";

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearched(q);
    search.mutate({ query: q });
  }

  function openPage(path: string) {
    navigate(docsUrl(docs, path));
    search.reset();
  }

  // Fills the window: a fixed header, then the page list and the page, each scrolling
  // on its own, so the header and list stay in place while reading.
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ flexShrink: 0, borderBottom: 1, borderColor: "divider" }}>
        <Stack
          direction="row"
          spacing={2}
          sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1, px: { xs: 2, md: 3 }, py: 1.5 }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <OpenWikiIcon sx={{ fontSize: 20, color: "primary.main" }} />
            <Typography variant="h6" component="h1">
              OpenWiki
            </Typography>
          </Stack>
          <ServeStatus />
          <Box sx={{ flex: 1 }} />
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {pullRequestUrl && (
              <Button size="small" href={pullRequestUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />}>
                Docs PR to merge
              </Button>
            )}
            <Tooltip title="Writes the wiki again and opens a pull request with it">
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AutoAwesomeIcon />}
                  loading={scanning}
                  disabled={running || scanning}
                  onClick={onScan}
                >
                  Regenerate
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Stack>
        {(running || scanError) && (
          <Stack spacing={1} sx={{ px: { xs: 2, md: 3 }, pb: 1.5 }}>
            {running && (
              <Alert severity="info" icon={false}>
                <Stack spacing={1}>
                  <Typography variant="body2">
                    Regenerating docs in the background. This page shows the current version until the new one lands.
                  </Typography>
                  <ScanProgress progress={progress} />
                </Stack>
              </Alert>
            )}
            {scanError && <Alert severity="error">{scanError}</Alert>}
          </Stack>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: { xs: "column", md: "row" } }}>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            width: { xs: "100%", md: 260 },
            maxHeight: { xs: 260, md: "none" },
            borderRight: { md: 1 },
            borderBottom: { xs: 1, md: 0 },
            borderColor: "divider",
          }}
        >
          <Box component="form" onSubmit={handleSearch} sx={{ p: 2, pb: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search the docs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search the docs"
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      {search.isPending ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1, pb: 2 }}>
            <PageNav sections={sections} activePage={search.isSuccess ? null : activePage} onNavigate={() => search.reset()} />
          </Box>
        </Box>

        {/* Keyed, so opening another page starts at its top. */}
        <Box
          key={search.isSuccess ? "search" : activePage}
          component="main"
          sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto" }}
        >
          {search.isError && (
            <Alert severity="error" sx={{ m: 2 }}>
              {errorMessage(search.error)}
            </Alert>
          )}
          {search.isSuccess ? (
            <SearchResults query={searched} results={search.data} onOpenPage={openPage} onClose={() => search.reset()} />
          ) : (
            <Box sx={{ px: { xs: 2, md: 6 }, py: { xs: 2, md: 4 }, maxWidth: 880, mx: "auto" }}>
              {activePage && (
                <Breadcrumbs separator="›" sx={{ mb: 2 }}>
                  <CrumbLink to={docs}>OpenWiki</CrumbLink>
                  {/* Each folder on the way, linking to its index when it has one. */}
                  {(folder ? folder.split("/") : []).map((part, i, parts) => {
                    const index = findPage(`${parts.slice(0, i + 1).join("/")}/`, pageList);
                    return index ? (
                      <CrumbLink key={i} to={docsUrl(docs, index)}>
                        {pageLabel(part)}
                      </CrumbLink>
                    ) : (
                      <Typography key={i} variant="caption" color="text.secondary">
                        {pageLabel(part)}
                      </Typography>
                    );
                  })}
                  <Typography variant="caption" color="text.primary">
                    {pageLabel(activePage)}
                  </Typography>
                </Breadcrumbs>
              )}
              {!activePage && splat && <Alert severity="warning">There&apos;s no docs page at {splat}.</Alert>}
              {activePage && page.isPending && (
                <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
                  <CircularProgress size={24} />
                </Box>
              )}
              {page.isError && <Alert severity="error">{errorMessage(page.error)}</Alert>}
              {page.data !== undefined && (
                <Box sx={{ "& > :first-of-type": { mt: 0 } }}>
                  {/* Without the page's YAML front matter, which would show as a stray heading. */}
                  <MarkdownText resolveLink={resolveLink}>{page.data.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")}</MarkdownText>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function DocsPage() {
  const status = useOpenWikiStatus();
  const pullRequest = useDocsPullRequest(status.data?.pullRequestUrl ?? null);
  const pages = useWikiPages();
  const scan = useStartScan();
  // Kept the same between renders, so the page's link handling doesn't change each time.
  const pageList = useMemo(() => [...(pages.data ?? [])].sort((a, b) => a.localeCompare(b)), [pages.data]);

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

  const hasWiki = pageList.length > 0;
  const running = status.data?.state === "running";

  if (!hasWiki) {
    if (running) {
      return (
        <GeneratingDocs
          startedAt={status.data?.startedAt ?? null}
          ignoreUsed={status.data?.ignoreUsed ?? null}
          progress={status.data?.progress ?? null}
        />
      );
    }
    return (
      <EmptyDocs
        failedError={status.data?.state === "failed" ? (status.data.error ?? "Unknown error") : null}
        onScan={handleScan}
        scanning={scanning || running}
        scanError={scanError}
        pullRequest={pullRequest}
      />
    );
  }

  return (
    <ReadyDocs
      pageList={pageList}
      pullRequestUrl={pullRequest.data?.state === "open" ? pullRequest.data.url : null}
      running={running}
      progress={status.data?.progress ?? null}
      onScan={handleScan}
      scanning={scanning}
      scanError={scanError}
    />
  );
}

export default DocsPage;
