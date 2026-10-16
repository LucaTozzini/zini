// Loads .env for `npm run dev`, preloaded with --import so it runs before any module
// reads process.env. Node's own --env-file makes watch mode watch .env's whole folder,
// data/ included, so every SQLite write would restart the backend.
try {
  process.loadEnvFile(".env");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
