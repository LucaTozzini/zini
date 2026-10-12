import { Alert, Button, Stack } from "@mui/material";
import { HTTPError } from "ky";
import type { WorkspaceChoice, WorkspaceSelection } from "shared";

export function WorkspaceChoices({ error, choose, busy }: { error: unknown; choose: (selection: WorkspaceSelection) => void; busy?: boolean }) {
  const choices = error instanceof HTTPError ? (error.data as { choices?: WorkspaceChoice[] } | undefined)?.choices : undefined;
  if (!choices) return null;
  return <Alert severity="info"><Stack spacing={1}>
    Choose the work to continue:
    {choices.map(p => <Button key={p.pr} disabled={busy} onClick={() => choose({ pullRequest: p.pr })}>
      Resume #{p.pr}: {p.title} ({p.state})
    </Button>)}
    <Button disabled={busy} onClick={() => choose({ fresh: true })}>Start a fresh branch</Button>
  </Stack></Alert>;
}
