import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HTTPError } from "ky";
import type { PullRequest } from "shared";
import { api } from "./client.ts";
import { projectApiPath, useProjectId } from "../hooks/useProject.ts";

export type OpenWikiScanState = "idle" | "running" | "failed" | "done";

export type OpenWikiStatus = {
  state: OpenWikiScanState;
  startedAt: string | null;
  error: string | null;
  ignoreUsed: "repo" | "default" | null;
  branch: string | null;
  pullRequestUrl: string | null;
  progress: OpenWikiProgress | null;
};

// The scan's latest step: openwiki's stages (planning, generating, finalizing),
// then zini's publishing. page and its index are set while generating.
export type OpenWikiProgress = {
  stage: string;
  page: string | null;
  pageIndex: number | null;
  pageCount: number | null;
};

export type OpenWikiServeStatus = {
  commit: string | null;
  mainCommit: string | null;
};

export type OpenWikiSearchResult = {
  page: string;
  section: string;
  excerpt: string;
};

export const openwikiKey = ["openwiki"];
// Each project's: its scan status, served commit, pages and their content.
const statusKey = (projectId: number) => [...openwikiKey, projectId, "status"];
const pagesKey = (projectId: number) => [...openwikiKey, projectId, "pages"];
const serveStatusKey = (projectId: number) => [...openwikiKey, projectId, "serve-status"];
const pageKey = (projectId: number, path: string) => [...openwikiKey, projectId, "page", path];

// A wiki page path may contain slashes; encode each segment so the backend's
// /*path splat receives it intact.
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

const wikiPath = (projectId: number, path: string) => projectApiPath(projectId, `openwiki/${path}`);

// Starts a documentation generation run. 202 on accept; the backend 409s when a run
// is already going (or a scan was requested twice).
function startScan(projectId: number) {
  return api.post(wikiPath(projectId, "scan"), { timeout: false }).json<{ started: boolean }>();
}

// Refreshes the served wiki checkout to the latest main, so the agents (and the
// page) see the newest committed docs.
function refreshServing(projectId: number) {
  return api.post(wikiPath(projectId, "refresh")).json<{ commit: string }>();
}

// The wiki's page list, or null when no wiki exists yet (the backend 404s).
function listPages(projectId: number): Promise<string[] | null> {
  return api
    .get(wikiPath(projectId, "pages"))
    .json<{ pages: string[] }>()
    .then(({ pages }) => pages)
    .catch((err) => {
      if (err instanceof HTTPError && err.response.status === 404) return null;
      throw err;
    });
}

export function useOpenWikiStatus() {
  const projectId = useProjectId();
  // Refetched on openwiki.updated, which the backend sends on every change.
  return useQuery({
    queryKey: statusKey(projectId),
    queryFn: () => api.get(wikiPath(projectId, "status")).json<OpenWikiStatus>(),
  });
}

export function useStartScan() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: () => startScan(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey(projectId) });
    },
  });
}

export function useRefreshServing() {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useMutation({
    mutationFn: () => refreshServing(projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serveStatusKey(projectId) });
      queryClient.invalidateQueries({ queryKey: pagesKey(projectId) });
    },
  });
}

// Outside openwikiKey: openwiki.updated comes with every step of a scan, and each sync
// asks GitHub. A new scan's PR changes the key instead.
const docsPullRequestKey = (projectId: number, scanPullRequestUrl: string | null) => [
  "openwiki-pull-request",
  projectId,
  scanPullRequestUrl,
];

// The docs pull request, checked when the page opens or regains focus, or with
// refetch. Once it's merged the backend pulls main, so the pages are read again.
export function useDocsPullRequest(scanPullRequestUrl: string | null) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  return useQuery({
    queryKey: docsPullRequestKey(projectId, scanPullRequestUrl),
    queryFn: async () => {
      const { pullRequest, refreshed } = await api
        .post(wikiPath(projectId, "sync"))
        .json<{ pullRequest: PullRequest | null; refreshed: boolean }>();
      if (refreshed) {
        queryClient.invalidateQueries({ queryKey: serveStatusKey(projectId) });
        queryClient.invalidateQueries({ queryKey: pagesKey(projectId) });
      }
      return pullRequest;
    },
    staleTime: 30_000,
  });
}

export function useServeStatus() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: serveStatusKey(projectId),
    queryFn: () => api.get(wikiPath(projectId, "serve-status")).json<OpenWikiServeStatus>(),
  });
}

export function useWikiPages() {
  const projectId = useProjectId();
  return useQuery({
    queryKey: pagesKey(projectId),
    queryFn: () => listPages(projectId),
    retry: false,
  });
}

export function useWikiPage(path: string | null) {
  const projectId = useProjectId();
  return useQuery({
    queryKey: pageKey(projectId, path ?? ""),
    queryFn: () => api.get(wikiPath(projectId, `pages/${encodePath(path as string)}`)).text(),
    enabled: path !== null,
    retry: false,
  });
}

// Search-only Q&A over the wiki: ranked sections, no model call.
export function useSearchWiki() {
  const projectId = useProjectId();
  return useMutation({
    mutationFn: ({ query, limit }: { query: string; limit?: number }) =>
      api.post(wikiPath(projectId, "search"), { json: { query, limit } }).json<OpenWikiSearchResult[]>(),
  });
}
