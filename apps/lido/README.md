# Lido Aragon App

This directory contains source files for the [Lido app](https://mainnet.lido.fi/#/lido-dao/0xae7ab96520de3a18e5e111b5eaab095312d7fe84/) that displays the core state of the protocol and provides controls for its essentials parameters.

## Verifying source code

To verify that the Lido app deployed at [Lido DAO](https://mainnet.lido.fi) was built from this source code, please follow instructions below.

### Prerequisites

- git
- Node.js 14+
- ipfs 0.12.0

### Steps

Clone the Lido DAO repo,

```bash
git clone https://github.com/lidofinance/lido-dao.git
```

Go into the directory,

```bash
cd lido-dao
```

Checkout [this commit](https://github.com/lidofinance/lido-dao/commit/5a30b1f7a461840e5919af57546887820b0b6dd0) (the latest `yarn.lock` update for the Lido app),

```bash
git checkout 5a30b1f7a461840e5919af57546887820b0b6dd0
```

Install dependencies **without updating the lockfile**. This will make sure that you're using the same versions of the dependencies that were used to develop the app,

```bash
yarn install --immutable
```

Build the static assets for the app,

```bash
# build Lido only
export APPS=lido
npx hardhat run scripts/build-apps-frontend.js
```

Get the IPFS hash of the build folder,

```bash
ipfs add -qr --only-hash apps/lido/dist/ | tail -n 1
```

This command should output `QmScYxzmmrAV1cDBjL3i7jzaZuiJ76UqdaFZiMgsxoFGzC`. Now that we have the IPFS hash, let's see that it is, in fact, the one that's used on the DAO website.

Open the [Lido app](https://mainnet.lido.fi/#/lido-dao/0xae7ab96520de3a18e5e111b5eaab095312d7fe84/) in your browser,
*screenshot here*

Open the network inspector,
*screenshot here*

Filter by `index.html`,
*screenshot here*

You will find that one of the HTML files has, in fact, been loaded from `https://ipfs.mainnet.fi/ipfs/QmScYxzmmrAV1cDBjL3i7jzaZuiJ76UqdaFZiMgsxoFGzC/index.html`.

You are done!

*screenshot here*
