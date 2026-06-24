# syntax=docker/dockerfile:1
#
# Brain + headless mm image (PLAN-C §5). The FastAPI brain shells out to `bun
# scripts/*.ts` (hot-key/viem signing) and to `mm` (TEE/session signing) with
# cwd=repo-root, so the image must carry the WHOLE repo (scripts import ../src and
# read records/) plus three toolchains: Python (brain), Node (mm CLI), Bun (scripts).
#
# The operator Ledger path (cast --ledger) is NOT in this image by design — minting a
# new subname is signed + broadcast from the operator's own machine (approve-mints.ts).
# Nothing the Ledger touches runs here; the brain only observes the on-chain result.

FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    BUN_INSTALL=/usr/local

# System deps + Node 20 (for the mm CLI). curl/unzip needed by the Bun installer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates unzip git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Bun — installs to $BUN_INSTALL/bin (on PATH). Use the LATEST release, not 1.3.5:
# 1.3.5 intermittently segfaults in the hot-key send path on linux/amd64 (the deployed
# arch), crashing /provision steps. The build logs print the resolved version.
RUN curl -fsSL https://bun.sh/install | bash

# mm — the MetaMask Agentic CLI. Pinned to the version the provision flow expects.
RUN npm install -g @metamask/agentic-cli@2.0.0

WORKDIR /app

# JS deps first as a cache layer (changes rarely). node_modules is .dockerignored, so
# the later COPY . . won't clobber what `bun install` builds here.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Python deps as a cache layer.
COPY brain/requirements.txt brain/requirements.txt
RUN pip install --no-cache-dir -r brain/requirements.txt

# The repo. scripts/ → ../src + records/ resolve under /app; gate.py/provision_routes
# run subprocesses with cwd=/app (REPO_ROOT = this dir).
COPY . .

RUN chmod +x entrypoint.sh

# Railway injects $PORT at runtime; 8000 is the local-docker default.
EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
