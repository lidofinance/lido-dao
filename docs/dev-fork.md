## Fork test / development

!NOTES!
You need an Infura node with [Archived Data](https://infura.io/docs/ethereum/add-ons/archiveData) access
or you can use an [Alchemy node](https://www.alchemy.com/) with Archived Data access for free

To run Aragon client and check apps on the fork, run `hardhat node`
```bash
npx hardhat node --fork https://mainnet.infura.io/v3/{WEB3_INFURA_PROJECT_ID}
```

Next, there are 2 options to run Aragon client

### Approach 1 - auto

```bash
NETWORK_NAME=mainnet RUN_CMD=mainnet node scripts/start-aragon.js
```

That script sets the right environment variables, downloads and starts Aragon client at `http://localhost:3000/#/lido-dao.aragonid.eth`

Sync data on the fork is not very fast, so you need to wait ~90sec


### Approach 2 - manual

Download [Aragon client](https://github.com/lidofinance/aragon-client) 
```bash
git clone git@github.com:lidofinance/aragon-client.git
```

```bash
cd aragon-client && yarn
```

Next, get lido apps ID  

```bash
export ARAGON_ENS_REGISTRY_ADDRESS=0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
export ARAGON_IPFS_GATEWAY=https://mainnet.lido.fi/ipfs
export ARAGON_DEFAULT_ETH_NODE=ws://localhost:8545
export ARAGON_APP_LOCATOR=0x3ca7c3e38968823ccb4c78ea688df41356f182ae1d159e4ee608d30d68cef320:http://localhost:3010/
yarn start:mainnet
```

Where:
* **ARAGON_ENS_REGISTRY_ADDRESS** - ENS address where `lido-de.aragon id.eth` is registered
* **ARAGON_DEFAULT_ETH_NODE** - local fork
* **ARAGON_APP_LOCATOR** - which source to load app frontend assets from, see more [here](https://github.com/lidofinance/aragon-client/blob/master/docs/CONFIGURATION.md#aragon_app_locator)

You can find the actual information in `deployed-mainnet.json`, for example, id of Lido app:
```javascript
"app:lido": {
    ...
    "id": "0x3ca7c3e38968823ccb4c78ea688df41356f182ae1d159e4ee608d30d68cef320",
    ...
},
```

So if you want to load the app frontend from localhost (not ipfs), you need to start the lido app and change **ARAGON_APP_LOCATOR**:
```bash
cd apps/lido/app && yarn && yarn dev

# Server running at http://localhost:3010 
```

```bash
export ARAGON_APP_LOCATOR=0x3ca7c3e38968823ccb4c78ea688df41356f182ae1d159e4ee608d30d68cef320:http://localhost:3010/
```
