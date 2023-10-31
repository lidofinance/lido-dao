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

Checkout [this commit](https://github.com/lidofinance/lido-dao/commit/[TBA]) (the latest `yarn.lock` update for the StakingRouter app),

```bash
git checkout [TBA]
```

Install dependencies **without updating the lockfile**. This will make sure that you're using the same versions of the dependencies that were used to develop the app,

```bash
yarn install --immutable
```

Build the static assets for the app,

```bash
# legacy app name
export APPS=sandbox
npx hardhat run scripts/build-apps-frontend.js
```

Get the IPFS hash of the build folder,

```bash
ipfs add -qr --only-hash apps/sandbox/dist/ | tail -n 1
```


This command should output `QmX9AFu9NEmvpKcC6tzJyhEC1krv4JZriWgG9QcMnnezQe`.


Now we have to obtain the content URI, which is this hash encoded for Aragon.

Now we run the script,

```bash
export IPFS_HASH=QmX9AFu9NEmvpKcC6tzJyhEC1krv4JZriWgG9QcMnnezQe npx hardhat run scripts/helpers/getContentUri.js
```

This command should print `0x697066733a516d5839414675394e456d76704b634336747a4a79684543316b7276344a5a72695767473951634d6e6e657a5165`, which is our content URI.

### 2. Verifying on-chain StakingRouter App content URI

Open the [Sandbox App Repo](https://etherscan.io/address/[TBA]#readProxyContract) and scroll down to `getLatest` method, open the dropdown and click "Query". This will give you the NodeOperatorsRegistry app version, contract address and the content URI. Now check that the content URI that you've obtained in the previous step matches the one that Etherscan fetched for you from the contract.

### 3. Verifying client-side resources

Now that we have the IPFS hash and content URI, let's see that it is, in fact, the one that's used on the DAO website.

Open the [SandBox app](https://mainnet.lido.fi/#/lido-dao/[TBA]/) in your browser, then open the network inspector and refresh the page to track all of the network requests that the website makes.

You will find that one of the two HTML files has, in fact, been loaded from `https://ipfs.mainnet.fi/ipfs/QmX9AFu9NEmvpKcC6tzJyhEC1krv4JZriWgG9QcMnnezQe/index.html`.

You are done! ✨
