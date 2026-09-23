import { useState, type FormEvent } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { errorMessage, useConnectLinear, useDisconnectLinear, useLinearStatus } from '../api.ts'

function LinearCard() {
  const status = useLinearStatus()
  const connect = useConnectLinear()
  const disconnect = useDisconnectLinear()
  const [apiKey, setApiKey] = useState('')
  const [replacing, setReplacing] = useState(false)

  const connected = status.data?.connected ?? false
  const showForm = !connected || replacing

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    connect.mutate(apiKey, {
      onSuccess: () => {
        setApiKey('')
        setReplacing(false)
      },
    })
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Linear</Typography>

          {status.isPending && <Typography color="text.secondary">Loading…</Typography>}
          {status.isError && <Alert severity="error">{errorMessage(status.error)}</Alert>}

          {status.isSuccess && connected && !status.data.valid && (
            <Alert severity="error">Linear no longer accepts this key. Replace it to reconnect.</Alert>
          )}

          {status.isSuccess && connected && !replacing && (
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography sx={{ flexGrow: 1 }}>
                Connected · key ending in <code>{status.data.keyHint}</code>
              </Typography>
              <Button onClick={() => setReplacing(true)}>Replace key</Button>
              <Button
                color="error"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </Stack>
          )}

          {status.isSuccess && showForm && (
            <Stack component="form" spacing={2} onSubmit={handleSubmit}>
              <TextField
                label="Linear API key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText="Create a personal API key in your Linear settings."
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
  )
}

function SettingsPage() {
  return (
    <>
      <Typography variant="h4" component="h1" gutterBottom>
        Settings
      </Typography>
      <LinearCard />
    </>
  )
}

export default SettingsPage
