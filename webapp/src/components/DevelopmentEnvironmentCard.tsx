import { useState, type FormEvent } from "react";
import { Alert, Button, Card, CardContent, Stack, TextField, Typography } from "@mui/material";
import { useDevelopmentEnvironment, useSaveDevelopmentEnvironment } from "../api/developmentEnvironment.ts";
import { errorMessage } from "../api/client.ts";

export default function DevelopmentEnvironmentCard({ repository }: { repository: string }) {
  const status = useDevelopmentEnvironment(repository);
  const save = useSaveDevelopmentEnvironment(repository);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      { variables: [{ name: name.trim(), value }] },
      {
        onSuccess: () => {
          setName("");
          setValue("");
        },
      },
    );
  }
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Development environment variables</Typography>
          <Typography variant="body2" color="text.secondary">
            For {repository}. Used by setup, Reviewer, QA and previews. Save development credentials here; values are never shown
            after saving. Restart running apps to apply changes. Zini’s generated database settings take precedence.
          </Typography>
          {status.isPending && <Typography>Loading…</Typography>}
          {status.isError && <Alert severity="error">{errorMessage(status.error)}</Alert>}
          {status.data?.variables.map((variable) => (
            <Stack key={variable.name} direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography component="code" sx={{ flexGrow: 1 }}>
                {variable.name} · {variable.configured ? "Configured" : "Empty"}
              </Typography>
              <Button
                disabled={save.isPending}
                onClick={() => {
                  setName(variable.name);
                  setValue("");
                }}
              >
                Replace
              </Button>
              <Button
                color="error"
                disabled={save.isPending}
                onClick={() => save.mutate({ variables: [{ name: variable.name, remove: true }] })}
              >
                Remove
              </Button>
            </Stack>
          ))}
          <Stack component="form" spacing={1.5} onSubmit={submit}>
            <TextField
              label="Variable name"
              placeholder="GOOGLE_GEMINI_API_KEY"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoComplete="off"
            />
            <TextField
              label="Value"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              required
              autoComplete="off"
            />
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" loading={save.isPending}>
                Save variable
              </Button>
              <Button component="label" disabled={save.isPending}>
                Import .env
                <input
                  type="file"
                  hidden
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setImportError(null);
                    try {
                      if (file.size > 80000) throw new Error("Choose a .env file under 80 KB");
                      save.mutate({ content: await file.text() });
                    } catch (error) {
                      setImportError(errorMessage(error));
                    }
                  }}
                />
              </Button>
            </Stack>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Import replaces matching names and adds new ones.
          </Typography>
          {save.isSuccess && <Alert severity="success">Development variables saved.</Alert>}
          {save.isError && <Alert severity="error">{errorMessage(save.error)}</Alert>}
          {importError && <Alert severity="error">{importError}</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}
