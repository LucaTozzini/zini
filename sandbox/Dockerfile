FROM mcr.microsoft.com/playwright:v1.63.0-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git curl openssl ca-certificates iptables util-linux && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/zini
COPY sandbox/package*.json ./
RUN npm ci --ignore-scripts
COPY sandbox/gateway.ts sandbox/entrypoint.sh sandbox/workspaceFiles.ts sandbox/gitPolicy.ts sandbox/trustedGit.ts ./sandbox/
COPY backend/src/repositories/repositoryFilesystem.ts ./backend/src/repositories/repositoryFilesystem.ts
COPY backend/src/workspaces/localAppRuntime.ts backend/src/workspaces/localHttp.ts backend/src/workspaces/developmentTls.ts ./backend/src/workspaces/
COPY backend/src/core/processes.ts ./backend/src/core/processes.ts
RUN chmod +x sandbox/entrypoint.sh && mkdir -p /workspace /state && chown -R pwuser:pwuser /workspace /state
ENV HOME=/state/home
EXPOSE 7777
ENTRYPOINT ["/opt/zini/sandbox/entrypoint.sh"]
