import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HTTPError } from 'ky'
import { api } from './client.ts'

export type OpenWikiScanState = 'idle' | 'running' | 'failed' | 'done'

export type OpenWikiStatus = {
  state: OpenWikiScanState
  startedAt: string | null
  error: string | null
  ignoreUsed: 'repo' | 'default' | null
  branch: string | null
  pullRequestUrl: string | null
  progress: OpenWikiProgress | null
}

// The scan's latest step: openwiki's stages (planning, generating, finalizing),
// then zini's publishing. page and its index are set while generating.
export type OpenWikiProgress = {
  stage: string
  page: string | null
  pageIndex: number | null
  pageCount: number | null
}

export type OpenWikiServeStatus = {
  commit: string | null
  mainCommit: string | null
}

export type OpenWikiSearchResult = {
  page: string
  section: string
  excerpt: string
}

export const openwikiKey = ['openwiki']
const statusKey = [...openwikiKey, 'status']
const pagesKey = [...openwikiKey, 'pages']
const serveStatusKey = [...openwikiKey, 'serve-status']
const pageKey = (path: string) => [...openwikiKey, 'page', path]

// A wiki page path may contain slashes; encode each segment so the backend's
// /*path splat receives it intact.
const encodePath = (path: string) =>
  path
    .split('/')
    .map(encodeURIComponent)
    .join('/')

// Starts a documentation generation run. 202 on accept; the backend 409s when a run
// is already going (or a scan was requested twice).
export function startScan() {
  return api.post('openwiki/scan', { timeout: false }).json<{ started: boolean }>()
}

export function getScanStatus() {
  return api.get('openwiki/status').json<OpenWikiStatus>()
}

// Refreshes the served wiki checkout to the latest main, so the MCP server (and the
// page) see the newest committed docs.
export function refreshServing() {
  return api.post('openwiki/refresh').json<{ commit: string }>()
}

export function getServeStatus() {
  return api.get('openwiki/serve-status').json<OpenWikiServeStatus>()
}

// The wiki's page list, or null when no wiki exists yet (the backend 404s).
export function listPages(): Promise<string[] | null> {
  return api
    .get('openwiki/pages')
    .json<{ pages: string[] }>()
    .then(({ pages }) => pages)
    .catch((err) => {
      if (err instanceof HTTPError && err.response.status === 404) return null
      throw err
    })
}

export function readPage(path: string) {
  return api.get(`openwiki/pages/${encodePath(path)}`).text()
}

export function searchWiki(query: string, limit?: number) {
  return api
    .post('openwiki/search', { json: { query, limit } })
    .json<OpenWikiSearchResult[]>()
}

export function useOpenWikiStatus() {
  // Refetched on openwiki.updated, which the backend sends on every change.
  return useQuery({
    queryKey: statusKey,
    queryFn: getScanStatus,
  })
}

export function useStartScan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: startScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: statusKey })
    },
  })
}

export function useRefreshServing() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: refreshServing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serveStatusKey })
      queryClient.invalidateQueries({ queryKey: pagesKey })
    },
  })
}

export function useServeStatus() {
  return useQuery({
    queryKey: serveStatusKey,
    queryFn: getServeStatus,
  })
}

export function useWikiPages() {
  return useQuery({
    queryKey: pagesKey,
    queryFn: listPages,
    retry: false,
  })
}

export function useWikiPage(path: string | null) {
  return useQuery({
    queryKey: pageKey(path ?? ''),
    queryFn: () => readPage(path as string),
    enabled: path !== null,
    retry: false,
  })
}

// Search-only Q&A over the wiki: ranked sections, no model call.
export function useSearchWiki() {
  return useMutation({
    mutationFn: ({ query, limit }: { query: string; limit?: number }) =>
      searchWiki(query, limit),
  })
}
