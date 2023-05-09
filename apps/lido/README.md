# Lido Aragon App

This directory contains source files for the [Lido Aragon frontend app](https://mainnet.lido.fi/#/lido-dao/0xae7ab96520de3a18e5e111b5eaab095312d7fe84/).

## Verifying source code

To verify that the Lido app frontend was built from this source code, please follow instructions below.

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

Checkout [this commit](https://github.com/lidofinance/lido-dao/commit/c3f680fc25d5ea48de69b65f4aff1f71723ef0e0) (the latest `yarn.lock` update for the Lido app),

```bash
git checkout c3f680fc25d5ea48de69b65f4aff1f71723ef0e0
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


This command should output `QmRSXAZrF2xR5rgbUdErDV6LGtjqQ1T4AZgs6yoXosMQc3`.


Now we have to obtain the content URI, which is this hash encoded for Aragon.

Now we run the script,

```bash
export IPFS_HASH=QmRSXAZrF2xR5rgbUdErDV6LGtjqQ1T4AZgs6yoXosMQc3
npx hardhat run scripts/helpers/getContentUri.js
```

This command should print `0x697066733a516d525358415a724632785235726762556445724456364c47746a7151315434415a677336796f586f734d516333`, which is our content URI.

### 2. Verifying on-chain Lido App content URI

Open the [Lido App Repo](https://etherscan.io/address/0xF5Dc67E54FC96F993CD06073f71ca732C1E654B1#readProxyContract) and scroll down to `getLatest` method, open the dropdown and click "Query". This will give you the Lido app version, contract address and the content URI. Now check that the content URI that you've obtained in the previous step matches the one that Etherscan fetched for you from the Lido protocol.  

### 3. Verifying client-side resources

Now that we have the IPFS hash and content URI, let's see that it is, in fact, the one that's used on the DAO website.

Open the [Lido app](https://mainnet.lido.fi/#/lido-dao/0xae7ab96520de3a18e5e111b5eaab095312d7fe84/) in your browser, then open the network inspector and refresh the page to track all of the network requests that the website makes.

You will find that one of the two HTML files has, in fact, been loaded from `https://ipfs.mainnet.fi/ipfs/QmRSXAZrF2xR5rgbUdErDV6LGtjqQ1T4AZgs6yoXosMQc3/index.html`.

You are done! ✨
