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

# The scanner's clone does not initialize Git submodules. Forge needs forge-std.
RUN git submodule update --init --recursive

# core uses Node 22 and Yarn 4.9.2.
RUN corepack enable \
    && corepack prepare yarn@4.9.2 --activate \
    && yarn install --immutable

# Hardhat downloads all compiler versions used by core during this online build.
RUN yarn compile

# Foundry, at the version core's CI pins, is optional: reproductions can be written in Hardhat,
# so a failure here must not fail the image.
RUN (curl -fsSL https://foundry.paradigm.xyz | bash \
    && /root/.foundry/bin/foundryup -i v1.7.1 \
    && forge build) || echo "WARNING: Foundry install or forge build failed; Hardhat remains available"

# Read-only reference material for the offline review, named in threat_model.md. Out of scan scope; each fetch is optional.
RUN mkdir -p /opt/lido && cd /opt/lido \
    && for repo in lido-improvement-proposals execution-delegation-framework dual-governance staking-modules; do \
         git clone --quiet --depth 1 "https://github.com/lidofinance/$repo" || echo "WARNING: could not fetch $repo"; \
       done \
    && (curl -fsSL -o /opt/lido/deployed-contracts.md \
          https://raw.githubusercontent.com/lidofinance/docs/main/docs/deployed-contracts/index.md \
        || echo "WARNING: could not fetch deployed-contracts.md")

# Smoke-test one bounded unit file so a broken image shows in the build log. A failing test must not fail the image.
RUN (timeout 900 yarn hardhat test --no-compile test/0.8.9/depositSecurityModule.test.ts \
    || echo "WARNING: smoke test reported failures")
