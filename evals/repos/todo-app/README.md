# To-dos

A small to-do app: an Express API and a React app, served by one server.

## Running it

```bash
npm ci
npm run dev
```

Then open http://localhost:3000. `PORT` sets the port, and `DATA_FILE` where the to-dos
are kept (`data/todos.json` by default).

For production, `npm run build`, then `npm start`.

## Scripts

- `npm run typecheck`: TypeScript, for the server and the app
- `npm run lint`: ESLint
- `npm test`: the server's tests (Vitest)
- `npm run build`: type-checks, then builds the app into `dist/`

## API

- `GET /api/todos`: every to-do
- `POST /api/todos` `{ title }`: adds one (400 without a title)
- `PATCH /api/todos/:id` `{ title?, done? }`: changes one (404 if it doesn't exist)
- `DELETE /api/todos/:id`: removes one (404 if it doesn't exist)
