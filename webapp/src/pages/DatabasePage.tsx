import { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import KeyIcon from "@mui/icons-material/Key";
import LinkIcon from "@mui/icons-material/Link";
import SyncIcon from "@mui/icons-material/Sync";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Graph, layout } from "@dagrejs/dagre";
import type { DatabaseSchema } from "shared";
import { errorMessage } from "../api/client.ts";
import { useDatabaseSchema } from "../api/database.ts";
import { useIntegrations } from "../api/integrations.ts";
import PostgresIcon from "../components/icons/PostgresIcon.tsx";

// The connected Postgres database drawn as a diagram: a box per table with its columns,
// and an arrow per foreign key, from the referencing column to the referenced one.

type Table = DatabaseSchema["tables"][number];
type TableNodeData = { table: Table; foreignKeys: Set<string>; showSchema: boolean };

const NODE_WIDTH = 280;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 24;
const tableHeight = (table: Table) => HEADER_HEIGHT + table.columns.length * ROW_HEIGHT + 8;

// A table: its name, then a row per column with its type, a key for the primary key and
// a link for foreign keys. Each row has its own handles, so arrows meet the column.
function TableNode({ data, selected }: NodeProps<Node<TableNodeData>>) {
  const { table, foreignKeys, showSchema } = data;
  return (
    <Box
      sx={{
        width: NODE_WIDTH,
        bgcolor: "background.paper",
        border: 1,
        borderColor: selected ? "primary.main" : "divider",
        borderRadius: 1.5,
        boxShadow: selected ? 4 : 1,
        overflow: "hidden",
        fontSize: 12,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", height: HEADER_HEIGHT, px: 1.5, bgcolor: "action.selected" }}
      >
        <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }} title={table.id}>
          {table.name}
        </Typography>
        {showSchema && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {table.schema}
          </Typography>
        )}
      </Stack>
      <Box sx={{ py: 0.5 }}>
        {table.columns.map((column) => (
          <Stack
            key={column.name}
            direction="row"
            spacing={0.75}
            sx={{ position: "relative", alignItems: "center", height: ROW_HEIGHT, px: 1.5 }}
          >
            <Handle type="target" position={Position.Left} id={`${column.name}-in`} style={{ opacity: 0 }} />
            <Box sx={{ width: 14, display: "inline-flex", color: column.primaryKey ? "warning.main" : "text.secondary" }}>
              {column.primaryKey ? (
                <KeyIcon sx={{ fontSize: 13 }} />
              ) : foreignKeys.has(column.name) ? (
                <LinkIcon sx={{ fontSize: 13 }} />
              ) : null}
            </Box>
            <Typography
              variant="caption"
              noWrap
              sx={{ flex: 1, minWidth: 0, fontWeight: column.primaryKey ? 600 : 400 }}
              title={column.name}
            >
              {column.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 110 }} title={column.type}>
              {column.type}
              {column.nullable ? "?" : ""}
            </Typography>
            <Handle type="source" position={Position.Right} id={`${column.name}-out`} style={{ opacity: 0 }} />
          </Stack>
        ))}
      </Box>
    </Box>
  );
}

const nodeTypes = { table: TableNode };

// Positions for the tables: those joined by foreign keys laid out left to right by
// dagre, from referencing to referenced; the rest, which would make a tall column of
// their own, in a grid under them.
function positions(tables: Table[], relations: DatabaseSchema["relations"]) {
  const linked = new Set(relations.flatMap((r) => [r.from, r.to]));
  const result = new Map<string, { x: number; y: number }>();
  const graph = new Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 120, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const table of tables.filter((t) => linked.has(t.id)))
    graph.setNode(table.id, { width: NODE_WIDTH, height: tableHeight(table) });
  for (const relation of relations) graph.setEdge(relation.from, relation.to);
  layout(graph);
  let bottom = 0;
  for (const id of graph.nodes()) {
    const node = graph.node(id);
    const height = node.height ?? 0;
    result.set(id, { x: (node.x ?? 0) - NODE_WIDTH / 2, y: (node.y ?? 0) - height / 2 });
    bottom = Math.max(bottom, (node.y ?? 0) + height / 2);
  }

  const rest = tables.filter((t) => !linked.has(t.id));
  const perRow = Math.max(3, Math.ceil(Math.sqrt(rest.length)));
  let y = linked.size ? bottom + 120 : 0;
  for (let i = 0; i < rest.length; i += perRow) {
    const row = rest.slice(i, i + perRow);
    row.forEach((table, j) => result.set(table.id, { x: j * (NODE_WIDTH + 40), y }));
    y += Math.max(...row.map(tableHeight)) + 40;
  }
  return result;
}

function Diagram({ schema, shownSchema }: { schema: DatabaseSchema; shownSchema: string }) {
  const { mode } = useColorScheme();
  const [selected, setSelected] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    const tables = schema.tables.filter((t) => shownSchema === "all" || t.schema === shownSchema);
    const ids = new Set(tables.map((t) => t.id));
    const relations = schema.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
    const foreignKeys = new Map<string, Set<string>>();
    for (const r of relations) foreignKeys.set(r.from, new Set([...(foreignKeys.get(r.from) ?? []), ...r.fromColumns]));
    const at = positions(tables, relations);
    return {
      nodes: tables.map((table): Node<TableNodeData> => ({
        id: table.id,
        type: "table",
        position: at.get(table.id) ?? { x: 0, y: 0 },
        data: { table, foreignKeys: foreignKeys.get(table.id) ?? new Set(), showSchema: shownSchema === "all" },
      })),
      edges: relations.map((r, i): Edge => ({
        id: `${r.from}-${r.to}-${i}`,
        source: r.from,
        target: r.to,
        sourceHandle: `${r.fromColumns[0]}-out`,
        targetHandle: `${r.toColumns[0]}-in`,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed },
      })),
    };
  }, [schema, shownSchema]);
  // React Flow keeps the tables' state (their measured size, where they're dragged, which
  // is selected). Diagram is keyed by what it shows, so new tables start a new one.
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState(nodes);

  // While a table is selected (clicked, or found), the tables it isn't linked to fade, so
  // it and its neighbours stand out.
  const related = useMemo(() => {
    if (!selected) return null;
    const ids = new Set([selected]);
    for (const edge of edges) {
      if (edge.source === selected) ids.add(edge.target);
      if (edge.target === selected) ids.add(edge.source);
    }
    return ids;
  }, [edges, selected]);
  const shownNodes = useMemo(
    () =>
      flowNodes.map((node) => ({
        ...node,
        style: { opacity: related && !related.has(node.id) ? 0.25 : 1, transition: "opacity 200ms" },
      })),
    [flowNodes, related],
  );

  // A found table is selected and brought into view, at a zoom where it can be read.
  function find(id: string | null) {
    setFlowNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
    setSelected(id);
    if (id) void fitView({ nodes: [{ id }], duration: 400, minZoom: 0.6, maxZoom: 1 });
  }

  // A selected table's foreign keys, in and out, stand out from the rest.
  const shownEdges = useMemo(
    () =>
      edges.map((edge) => {
        const active = selected !== null && (edge.source === selected || edge.target === selected);
        return {
          ...edge,
          animated: active,
          style: { stroke: active ? "var(--mui-palette-primary-main)" : undefined, strokeWidth: active ? 2 : 1 },
          zIndex: active ? 1 : 0,
        };
      }),
    [edges, selected],
  );

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
      <Box sx={{ position: "absolute", top: 12, left: 12, zIndex: 5, width: 280 }}>
        <Autocomplete
          size="small"
          options={nodes.map((n) => n.id)}
          getOptionLabel={(id) => (shownSchema === "all" ? id : id.slice(id.indexOf(".") + 1))}
          value={selected}
          onChange={(_e, id) => find(id)}
          renderInput={(params) => (
            <TextField {...params} placeholder="Find a table" sx={{ bgcolor: "background.paper", borderRadius: 1 }} />
          )}
        />
      </Box>
      <ReactFlow
        nodes={shownNodes}
        onNodesChange={onNodesChange}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        colorMode={mode === "light" ? "light" : "dark"}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.05}
        nodesConnectable={false}
        onSelectionChange={({ nodes: chosen }) => setSelected(chosen[0]?.id ?? null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={mode === "light" ? "#c4cddb" : "#5b6474"} />
      </ReactFlow>
    </Box>
  );
}

function DatabasePage() {
  const integrations = useIntegrations();
  const status = integrations.data?.postgres;
  const connected = Boolean(status?.connected);
  const schema = useDatabaseSchema(connected);
  const [shownSchema, setShownSchema] = useState<string | null>(null);

  const schemas = [...new Set((schema.data?.tables ?? []).map((t) => t.schema))].sort();
  // Until one is chosen: public when there is one, else the first.
  const current = shownSchema ?? (schemas.includes("public") ? "public" : (schemas[0] ?? "all"));
  const count = (name: string) => schema.data?.tables.filter((t) => name === "all" || t.schema === name).length ?? 0;

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{
          flexShrink: 0,
          alignItems: "center",
          flexWrap: "wrap",
          rowGap: 1,
          px: { xs: 2, md: 3 },
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <PostgresIcon sx={{ fontSize: 20, color: "primary.main" }} />
          <Typography variant="h6" component="h1">
            Database
          </Typography>
        </Stack>
        {connected && (
          <Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
            {status?.keyHint}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {schema.data && schemas.length > 0 && (
          <TextField
            select
            size="small"
            label="Schema"
            value={current}
            onChange={(e) => setShownSchema(e.target.value)}
            sx={{ minWidth: 220 }}
          >
            {schemas.map((name) => (
              <MenuItem key={name} value={name}>
                {name} ({count(name)})
              </MenuItem>
            ))}
            <MenuItem value="all">All schemas ({count("all")})</MenuItem>
          </TextField>
        )}
        {connected && (
          <Tooltip title="Read the tables again">
            <span>
              <IconButton
                size="small"
                aria-label="Read the tables again"
                loading={schema.isFetching}
                onClick={() => void schema.refetch()}
              >
                <SyncIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Stack>

      {integrations.isSuccess && !connected ? (
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", my: 10, px: 2 }}>
          <PostgresIcon sx={{ fontSize: 48, color: "primary.main" }} />
          <Typography variant="h5" component="h2">
            No database connected
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
            Connect your Postgres database, read-only, to see its tables and how they relate, and to let the Project Lead query
            it.
          </Typography>
          <Button variant="contained" component={RouterLink} to="/settings">
            Connect in Settings
          </Button>
        </Stack>
      ) : schema.isError ? (
        <Alert severity="error" sx={{ m: 3 }}>
          {errorMessage(schema.error)}
        </Alert>
      ) : !schema.data ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 10 }}>
          <CircularProgress size={28} />
        </Box>
      ) : schema.data.tables.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 4, textAlign: "center" }}>
          The connected user can&apos;t read any tables. Grant it SELECT on the schemas to show.
        </Typography>
      ) : (
        <ReactFlowProvider>
          <Diagram key={`${current}-${schema.dataUpdatedAt}`} schema={schema.data} shownSchema={current} />
        </ReactFlowProvider>
      )}
    </Box>
  );
}

export default DatabasePage;
