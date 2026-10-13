# The scanner clones core, then builds this file with that checkout as the context.
# Network access ends after the image is built, so keep dependencies and compiler caches in the final image.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 build-essential pkg-config unzip \
    && rm -rf /var/lib/apt/lists/*

ENV HUSKY=0 \
    MODE=scratch \
    SKIP_GAS_REPORT=1 \
    SKIP_CONTRACT_SIZE=1 \
    PATH=/root/.foundry/bin:$PATH

COPY . /src
WORKDIR /src

# core uses Node 22 and Yarn 4.9.2.
RUN corepack enable \
    && corepack prepare yarn@4.9.2 --activate \
    && yarn install --immutable

# Hardhat downloads all compiler versions used by core during this online build.
RUN yarn compile

# Foundry, at the version core's CI pins, is optional: reproductions can be written in Hardhat,
# so a failure here must not fail the image.
# The scanner's clone does not initialize Git submodules. Only Forge needs forge-std.
RUN (git submodule update --init --recursive \
    && curl -fsSL -o /tmp/foundry-installer.sh https://foundry.paradigm.xyz \
    && bash /tmp/foundry-installer.sh \
    && rm -f /tmp/foundry-installer.sh \
    && /root/.foundry/bin/foundryup -i v1.7.1 \
    && forge build) || echo "WARNING: forge-std fetch, Foundry install or forge build failed; Hardhat remains available"

# Reference material for the offline review, outside scan scope. Each fetch is optional.
# EDF follows core's EDF_REPO_REF. Other pins: LIPs snapshot; staking-modules v3.0.
# Update contract pins for relevant production upgrades, and docs/LIPs for relevant registry or specification changes.
# The registry snapshot is from 2026-10-12; its core addresses and v4.1.0 label were reviewed on 2026-10-13.
RUN mkdir -p /opt/lido \
    && edf_ref="$(sed -nE 's/^export const EDF_REPO_REF = "([0-9a-f]{40})";$/\1/p' scripts/utils/execution-delegation-framework.ts || true)" \
    && for reference in \
         lido-improvement-proposals:b3f58400a576d01a5a160de69fa823283b38bc3f \
         "execution-delegation-framework:$edf_ref" \
         staking-modules:4d3de6658499e1c1774951780a97d7ae25ca18b8; do \
         repo="${reference%%:*}"; ref="${reference#*:}"; \
         (test -n "$ref" \
           && git init --quiet "/opt/lido/$repo" \
           && git -C "/opt/lido/$repo" fetch --quiet --depth 1 "https://github.com/lidofinance/$repo" "$ref" \
           && git -C "/opt/lido/$repo" checkout --quiet --detach "$ref") \
           || { rm -rf "/opt/lido/$repo"; echo "WARNING: could not fetch $repo at ${ref:-<missing ref>}"; }; \
       done \
    && (curl -fsSL -o /opt/lido/deployed-contracts.md \
          https://raw.githubusercontent.com/lidofinance/docs/c261dab80c82609d947c6eaccfe0129aa03fe3e6/docs/deployed-contracts/index.md \
        || { rm -f /opt/lido/deployed-contracts.md; echo "WARNING: could not fetch deployed-contracts.md"; })

# Smoke-test one bounded unit file so a broken image shows in the build log. A failing test must not fail the image.
RUN (timeout 900 yarn hardhat test --no-compile test/0.8.9/depositSecurityModule.test.ts \
    || echo "WARNING: smoke test reported failures")
