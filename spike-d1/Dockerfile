# D1 spike — can `mm` run headless + restore a session + TEE-sign inside a Linux container?
# glibc base: the only native addons in @metamask/agentic-cli (keccak, utf-8-validate)
# ship linux-x64 glibc prebuilds, so node:20-bookworm-slim avoids any compile step.
FROM node:20-bookworm-slim

# ca-certificates for the HTTPS calls mm makes to the TEE/relayer + RPC.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq \
 && rm -rf /var/lib/apt/lists/*

# Pin to the exact version the live session was created with.
RUN npm i -g @metamask/agentic-cli@2.0.0

# Session is mounted at runtime (-v ~/.metamask:/root/.metamask:ro for read tests,
# rw for the persistence test). Never bake the session into the image.
WORKDIR /root
ENTRYPOINT ["/bin/bash"]
