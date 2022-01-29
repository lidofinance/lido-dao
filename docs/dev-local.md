## Local development

Networks are defined in `hardhat.config.js` file. To select the target network for deployment,
set `NETWORK_NAME` environment variable to a network name defined in that file. All examples
below assume `localhost` is the target network.

#### Network state file

Deployment scripts read their config from and store their results to a file called `deployed-{network_name}.json`,
located in the repo root. This file has the following structure and should always be committed:

```js
{
  "networkId": 31337,
  "owner": "0x5626f3Cf58741768f2B5F09beF0bA50489E17f74",
  ...etc
}
```

When a script sees that some contract address is already defined in the network state file, it won't
re-deploy the same contract. This means that all deployment scripts are idempotent, you can call the
same script twice and the second call will be a nop.

You may want to specify some of the configuration options in `networks.<netId>` prior to running
deployment to avoid those values being set to default values:

* `owner` The address that everything will be deployed from.
* `ensAddress` The address of a ENS instance.
* `depositContractAddress` The address of the Beacon chain deposit contract (it will deployed otherwise).
* `daoInitialSettings` Initial settings of the DAO; see below.

You may specify any number of additional keys inside any network state, they will be left intact by
deployment scripts.

#### DAO initial settings

Initial DAO settings can be specified prior to deployment for the specific network in
`networks.<netId>.daoInitialSettings` field inside `deployed.json` file.

* `holders` Addresses of initial DAO token holders.
* `stakes` Initial DAO token balances of the holders.
* `tokenName` Name of the DAO token.
* `tokenSymbol` Symbol of the DAO token.
* `voteDuration` See [Voting app documentation].
* `votingSupportRequired` See [Voting app documentation].
* `votingMinAcceptanceQuorum` See [Voting app documentation].
* `depositIterationLimit` See [protocol levers documentation].

[Aragon voting app] source code

[Aragon voting app]: http://web.archive.org/web/20200919192750/https://wiki.aragon.org/archive/dev/apps/voting/
[Voting app documentation]: https://wiki.aragon.org/archive/dev/apps/voting
[protocol levers documentation]: /docs/protocol-levers.md

An example of `deployed.json` file prepared for a testnet deployment:

```js
{
  "networks": {
    "5": {
      "networkName": "goerli",
      "depositContractAddress": "0x07b39f4fde4a38bace212b546dac87c58dfe3fdc",
      "owner": "0x3463dD800410965fdBeC2958085b1467CBd4aA31",
      "daoInitialSettings": {
        "holders": [
          "0x9be0D8ef365A7217c2313c3f33a71D5CeBea2686",
          "0x7B1F4c068b3E89Cc586c2f3656Bd95f56CA5B10A",
          "0x6244D856606c874DEAC61a61bd07698d47a6F6F2"
        ],
        "stakes": [
          "100000000000000000000",
          "100000000000000000000",
          "100000000000000000000"
        ],
        "tokenName": "Lido DAO Testnet Token",
        "tokenSymbol": "LDO",
        "voteDuration": 86400,
        "votingSupportRequired": "500000000000000000",
        "votingMinAcceptanceQuorum": "300000000000000000",
        "beaconSpec": {
          "epochsPerFrame": 225,
          "slotsPerEpoch": 32,
          "secondsPerSlot": 12,
          "genesisTime": 1605700807
        }
      }
    }
  }
}
```

# How to build local dev environment

To run dev env we need:
* install dependencies
* install and start IPFS daemon
* start hardhat node
* deploy contracts to local hardhat node
* start lido apps on local port
* start aragon client

#### Step 1: install yarn dependencies

```bash
yarn
```


#### Step 2: install IPFS daemon


See ipfs install instructions [here](https://docs.ipfs.io/install/ipfs-desktop/#ubuntu)

For example install via Homebrew
```bash
brew install ipfs --cask
```

and start in different terminal

```bash
ipfs daemon
```

IPFS is needed to upload an Aragon Apps like (Finance, Voting, etc...) and Lido apps (Lido, LidoOracle,NOS)


#### Step 3: start hardhat node in different terminal

```bash
npx hardhat node
```

This command starts a local eth node with 20 unlocked accounts


#### Step 4: set NETWORK_NAME env

```bash
export NETWORK_NAME=localhost
```

#### Step 5: deploy Aragon environment and core apps

On this step we can deploy all required contracts and upload all required apps to IPFS with next command

```bash
yarn deploy:all 
```
This is required for test/dev networks that don't have Aragon environment deployed.

But you can execute deploy scripts step by step:
```bash
# compile contracts at contracts/ folder
yarn compile

# ENS, APMRegistryFactory, DAOFactory, APMRegistry for aragonpm.eth, etc.
NETWORK_NAME=localhost yarn deploy:aragon-env

# Core Aragon apps: voting, vault, etc.
NETWORK_NAME=localhost yarn deploy:aragon-std-apps

# Deploy Lido APM registry and DAO template
NETWORK_NAME=localhost yarn deploy:apm-and-template

# Build and deploy Lido applications: Lido, Lido Oracle, Node Operator Registry apps
NETWORK_NAME=localhost yarn deploy:apps

# Deploy the DAO
#
# This step deploys DepositContract as well, if depositContractAddress is not specified
# in deployed.json
NETWORK_NAME=localhost yarn deploy:dao
```

#### Step 7. Start Lido apps

```bash
yarn lido:apps
```

#### Step 8. Start Aragon client

```bash
NETWORK_NAME=localhost yarn aragon:start
```

In this step we are replacing the links to the app from the IPFS with a local port,
set env `ARAGON_APP_LOCATOR=0x8a7b...c6:http://localhost:3010` and start aragon client on http://localhost:3000

