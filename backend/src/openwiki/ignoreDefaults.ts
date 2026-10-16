// Default .openwikiignore applied by zini when the repo has none of its own.
// Repo-agnostic: secrets, dependencies, build outputs, and noise. Written into the
// disposable generation worktree only; never committed to the user's repo.
export const DEFAULT_OPENWIKIIGNORE = `# Default ignores applied by zini when the repo has no .openwikiignore

# secrets: never read, never reproduced in docs
.env
.env.*
*.pem
*.key
*.p12
credentials.json
.npmrc

# dependencies
node_modules/
vendor/
.venv/
venv/
__pycache__/
*.pyc

# build outputs
dist/
build/
out/
target/
bin/
obj/
.next/
.nuxt/
.turbo/

# noise
.git/
.idea/
.vscode/
.DS_Store
Thumbs.db
*.log
coverage/
.nyc_output/
`;
