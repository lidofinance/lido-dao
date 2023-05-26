# LidoOracle Aragon App

This directory contains source files for the [LidoOracle Aragon frontend app](https://mainnet.lido.fi/#/lido-dao/0x442af784a788a5bd6f42a01ebe9f287a871243fb/).

## Verifying source code

To verify that the LidoOracle app frontend was built from this source code, please follow instructions below.

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

Checkout [this commit](https://github.com/lidofinance/lido-dao/commit/c3f680fc25d5ea48de69b65f4aff1f71723ef0e0) (the latest `yarn.lock` update for the LidoOracle app),

```bash
git checkout c3f680fc25d5ea48de69b65f4aff1f71723ef0e0
```

Install dependencies **without updating the lockfile**. This will make sure that you're using the same versions of the dependencies that were used to develop the app,

```bash
yarn install --immutable
```

Build the static assets for the app,

```bash
# build Oracle only
export APPS=lidooracle
npx hardhat run scripts/build-apps-frontend.js
```

Get the IPFS hash of the build folder,

```bash
ipfs add -qr --only-hash apps/lidooracle/dist/ | tail -n 1
```


This command should output `QmWTacPAUrQaCvAMVcqnTXvnr9TLfjWshasc4xjSheqz2i`.


Now we have to obtain the content URI, which is this hash encoded for Aragon.

Now we run the script,

```bash
export IPFS_HASH=QmWTacPAUrQaCvAMVcqnTXvnr9TLfjWshasc4xjSheqz2i
npx hardhat run scripts/helpers/getContentUri.js
```

This command should print `0x697066733a516d575461635041557251614376414d5663716e5458766e7239544c666a57736861736334786a536865717a3269`, which is our content URI.

### 2. Verifying on-chain LidoOracle App content URI

Open the [Oracle App Repo](https://etherscan.io/address/0xF9339DE629973c60c4d2b76749c81E6F40960E3A#readProxyContract) and scroll down to `getLatest` method, open the dropdown and click "Query". This will give you the Oracle app version, contract address and the content URI. Now check that the content URI that you've obtained in the previous step matches the one that Etherscan fetched for you from the contract.  

### 3. Verifying client-side resources

Now that we have the IPFS hash and content URI, let's see that it is, in fact, the one that's used on the DAO website.

Open the [Lido app](https://mainnet.lido.fi/#/lido-dao/0x442af784a788a5bd6f42a01ebe9f287a871243fb/) in your browser, then open the network inspector and refresh the page to track all of the network requests that the website makes.

You will find that one of the two HTML files has, in fact, been loaded from `https://ipfs.mainnet.fi/ipfs/QmWTacPAUrQaCvAMVcqnTXvnr9TLfjWshasc4xjSheqz2i/index.html`.

You are done! ✨
