# StakingRouter Aragon App

This directory contains source files for the [StakingRouter Aragon frontend app](https://mainnet.lido.fi/#/lido-dao/0x55032650b14df07b85bf18a3a3ec8e0af2e028d5/).

## Verifying source code

To verify that the StakingRouter app frontend was built from this source code, please follow instructions below.

### Prerequisites

- git
- Node.js 16.14.2
- ipfs 0.19.0

### 1. Replicating IPFS hash and content URI

Clone the Lido DAO repo,

```bash
git clone https://github.com/lidofinance/lido-dao.git
```

Go into the directory,

```bash
cd lido-dao
```

Checkout [this commit](https://github.com/lidofinance/lido-dao/commit/34f5d0d428fcb51aae74f0cb7387b9bd59916817) (the latest `yarn.lock` update for the StakingRouter app),

```bash
git checkout 34f5d0d428fcb51aae74f0cb7387b9bd59916817
```

Install dependencies **without updating the lockfile**. This will make sure that you're using the same versions of the dependencies that were used to develop the app,

```bash
yarn install --immutable
```

Build the static assets for the app,

```bash
# legacy app name
export APPS=node-operators-registry
npx hardhat run scripts/build-apps-frontend.js
```

Get the IPFS hash of the build folder,

```bash
ipfs add -qr --only-hash apps/node-operators-registry/dist/ | tail -n 1
```


This command should output `QmT4jdi1FhMEKUvWSQ1hwxn36WH9KjegCuZtAhJkchRkzp`.


Now we have to obtain the content URI, which is this hash encoded for Aragon.

Now we run the script,

```bash
export IPFS_HASH=QmT4jdi1FhMEKUvWSQ1hwxn36WH9KjegCuZtAhJkchRkzp
npx hardhat run scripts/helpers/getContentUri.js
```

This command should print `0x697066733a516d54346a64693146684d454b5576575351316877786e33365748394b6a656743755a7441684a6b6368526b7a70`, which is our content URI.

### 2. Verifying on-chain StakingRouter App content URI

Open the [NodeOperatorsRegistry App Repo](https://etherscan.io/address/0x0D97E876ad14DB2b183CFeEB8aa1A5C788eB1831#readProxyContract) and scroll down to `getLatest` method, open the dropdown and click "Query". This will give you the NodeOperatorsRegistry app version, contract address and the content URI. Now check that the content URI that you've obtained in the previous step matches the one that Etherscan fetched for you from the contract.  

### 3. Verifying client-side resources

Now that we have the IPFS hash and content URI, let's see that it is, in fact, the one that's used on the DAO website.

Open the [StakingRouter app](https://mainnet.lido.fi/#/lido-dao/0x55032650b14df07b85bf18a3a3ec8e0af2e028d5/) in your browser, then open the network inspector and refresh the page to track all of the network requests that the website makes.

You will find that one of the two HTML files has, in fact, been loaded from `https://ipfs.mainnet.fi/ipfs/QmT4jdi1FhMEKUvWSQ1hwxn36WH9KjegCuZtAhJkchRkzp/index.html`.

You are done! ✨
