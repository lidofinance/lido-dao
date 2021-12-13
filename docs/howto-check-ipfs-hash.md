# Check IPFS hash

This HOWTO describes how to check IPFS apps hash

### Step 1. Clone the official repo and go to the folder

```bash
git clone git@github.com:lidofinance/lido-dao.git && cd lido-dao
```

Switch to `aragon-dev` branch
```bash
git checkout aragon-dev
```

### Step 2. Install dependencies

```bash
yarn
```

### Step 3. Build apps
```bash
yarn build:apps
```

After that you can check next folder:
* Lido app - `apps/lido/dist/`
* Lido oracle app - `apps/lidooracle/dist/`
* NOS app - `apps/node-operators-registry/dist/`

### Step 4. Install IPFS

This step needs to create and check the IPFS hash

See ipfs install instructions [here](https://docs.ipfs.io/install/ipfs-desktop/#ubuntu)

For example, install via Homebrew
```bash
brew install ipfs --cask
```

## Step 4. Check IPFS hash for directory

```bash
ipfs add -qr --only-hash apps/lido/dist/ | tail -n 1
QmQkJMtvu4tyJvWrPXJfjLfyTWn959iayyNjp7YqNzX7pS
```

```bash
ipfs add -qr --only-hash apps/lidooracle/dist/ | tail -n 1
Qmea89MU3PHRP7cQ1Wak6r2sUeMUAF2L9rq2bLmYcdKvLW
```

```bash
ipfs add -qr --only-hash apps/node-operators-registry/dist/ | tail -n 1
Qma7PXHmEj4js2gjM9vtHPtqvuK82iS5EYPiJmzKLzU58G
```

