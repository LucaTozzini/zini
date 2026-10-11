import { useMemo } from 'react'
import { Link as RouterLink } from 'react-router'
import { Alert, Box, Link, Skeleton, Typography, useTheme } from '@mui/material'
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useProjectLeadSubscriptions, useThreads } from '../api/projectLead.ts'

export default function SubscriptionsGraph() {
  const subscriptions = useProjectLeadSubscriptions()
  const threads = useThreads()
  const theme = useTheme()
  const { nodes, edges } = useMemo(() => {
    const entries = subscriptions.data ?? []
    const forgeIds = [...new Set(entries.flatMap((entry) => entry.forgeIds))]
    const titles = new Map(threads.data?.map((thread) => [thread.id, thread.title]))
    const nodeStyle = {
      width: 240, borderRadius: 12, padding: 16,
      background: theme.palette.background.paper, color: theme.palette.text.primary,
      borderColor: theme.palette.divider, textAlign: 'left' as const,
    }
    const label = (kind: string, title: string, path: string) => (
      <Box>
        <Typography variant="overline" color="text.secondary">{kind}</Typography>
        <Link component={RouterLink} to={path} className="nodrag" underline="hover"
          sx={{ display: 'block', overflowWrap: 'anywhere' }}>{title}</Link>
      </Box>
    )
    const nodes: Node[] = [
      ...entries.map(({ threadId }, index) => ({
        id: `pl:${threadId}`, type: 'input', sourcePosition: Position.Right,
        position: { x: 0, y: index * 150 + Math.max(0, forgeIds.length - entries.length) * 75 },
        data: { label: label('Project Lead', titles.get(threadId) ?? threadId, `/project-lead/${threadId}`) },
        style: { ...nodeStyle, borderColor: theme.palette.primary.main },
      })),
      ...forgeIds.map((forgeId, index) => ({
        id: `forge:${forgeId}`, type: 'output', targetPosition: Position.Left,
        position: { x: 440, y: index * 150 + Math.max(0, entries.length - forgeIds.length) * 75 },
        data: { label: label('Forge', forgeId, `/issues/${forgeId}`) },
        style: { ...nodeStyle, borderColor: theme.palette.secondary.main },
      })),
    ]
    const edges: Edge[] = entries.flatMap(({ threadId, forgeIds }) =>
      [...new Set(forgeIds)].map((forgeId) => ({
        id: JSON.stringify([threadId, forgeId]), source: `pl:${threadId}`, target: `forge:${forgeId}`,
        style: { stroke: theme.palette.primary.main, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color: theme.palette.primary.main },
        ariaLabel: `Project Lead ${titles.get(threadId) ?? threadId} subscribes to Forge ${forgeId}`,
      })))
    return { nodes, edges }
  }, [subscriptions.data, threads.data, theme])

  if (subscriptions.isPending) return <Skeleton variant="rounded" height={440} />
  if (subscriptions.isError) return <Alert severity="error">Could not load subscriptions.</Alert>
  if (!nodes.length) return <Typography color="text.secondary">No subscriptions yet.</Typography>

  return (
    <Box sx={{ height: 440, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.2 }}
        colorMode={theme.palette.mode} nodesDraggable={false} nodesConnectable={false}
        edgesReconnectable={false} deleteKeyCode={null} minZoom={0.1} maxZoom={1.5}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </Box>
  )
}
