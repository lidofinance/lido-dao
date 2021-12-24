# Check IPFS hash

This HOWTO describes how to check IPFS apps hash

### Requirements

- git
- node v12
- yarn
- ipfs

### Step 1. Clone the official repo and go to the folder

```bash
git clone https://github.com/lidofinance/lido-dao.git && cd lido-dao
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

See ipfs install instructions [here](https://docs.ipfs.io/install/command-line/#official-distributions)

```
M1-based Macs

You can install IPFS on M1-based Macs by using the darwin-arm64 binary instead of the amd64 binary listed in these instructions.
```

```bash
#Download the macOS binary from https://dist.ipfs.io/#go-ipfs
curl -O https://dist.ipfs.io/go-ipfs/v0.10.0/go-ipfs_v0.10.0_darwin-amd64.tar.gz

#Unzip the file:
tar -xvzf go-ipfs_v0.10.0_darwin-amd64.tar.gz

#Move into the go-ipfs folder and run the install script:
cd go-ipfs
bash install.sh

#Check that IPFS installed:
ipfs --version

> ipfs version 0.10.0   
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

