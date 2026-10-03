# The eval container: zini, the test repos with their dependencies installed, Chromium
# for the QA's browser, and git. Built from the repo's root:
#   docker build -f evals/Dockerfile -t zini-evals .
# zini's backend builds and runs it when an eval starts (see backend/src/evals.ts).
FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /zini

# Dependencies before the code, so changing the code doesn't reinstall them.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY webapp/package.json webapp/
RUN npm ci

COPY evals/repos/todo-app/package.json evals/repos/todo-app/package-lock.json evals/repos/todo-app/
RUN cd evals/repos/todo-app && npm ci

COPY . .

# Results go to /results, mounted from the machine; runs work in the container's /work.
ENV EVAL_RESULTS=/results EVAL_WORK=/work
ENTRYPOINT ["npx", "tsx", "evals/run.ts"]
