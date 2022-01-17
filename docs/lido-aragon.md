# Lido-aragon

`lido-aragon` tool is used to create, develop lido/aragon apps.

We already have a pre-build versions for linux/mac and amd/arm architecture.

```bash
#mac
cli/build/lido-aragon_darwin_amd64
cli/build/lido-aragon_darwin_arm64

#linux
cli/build/lido-aragon_linux_amd64
cli/build/lido-lido-aragon_linux_arm64
```

Please copy need version to `cli/` folder:
```bash
#apple m1
cp cli/build/lido-aragon_darwin_arm64 cli/lido-aragon
```

#### Step 1. Install IPFS

[https://docs.ipfs.io/install/](https://docs.ipfs.io/install/command-line/)



#### Step 2. Install project dependencies
```bash
yarn
```

#### Step 3. Run cli

```bash
cd cli/ && ./lido-aragon
```

Result
```bash
lido-aragon: lido tool to start aragon env

Usage:
  lido-aragon [command]

Available Commands:
  start       Start local or form env

Flags:
      --apps string        Which source to load app frontend assets from
      --apps-path string   Lido apps path
      --fork string        Fork endpoint https://mainnet.infura.io/v3/{WEB3_INFURA_PROJECT_ID}
  -h, --help               help for lido-aragon
      --network string     Set deploy network name (default "localhost")
  -v, --verbose            Verbose output all of services
      --version            version for lido-aragon

Use "lido-aragon [command] --help" for more information about a command.
```


## Start local environment

```bash
cd cli && ./lido-aragon start all
```

By this command we:
- start hardhat local node
- start IPFS daemon (need to deploy apps frontend)
- deploy ENS, APMRegistryFactory, DAOFactory, APMRegistry for aragonpm.eth, etc
- deploy Core Aragon apps: voting, vault, etc
- deploy Lido APM registry and DAO template
- build and deploy Lido applications: Lido, Lido Oracle, Node Operator Registry apps
- deploy the DAO
- start Lido apps 
- start Aragon with replacing lido apps links to local port

if something wrong you can use verbose `-v` flag:
```bash
./lido-aragon start all -v
```


```bash
bash-3.2$ ./lido-aragon start all
 SUCCESS  Contracs: compile...done
 SUCCESS  Hardhat node: Started
 SUCCESS  IPFS: Started
 SUCCESS  Deploy: Aragon env... done
▀  Deploy: Aragon standart apps... (7s)
```

### Start fork

```bash
./lido-aragon start fork --fork https://mainnet.infura.io/v3/{WEB3_INFURA_PROJECT_ID} --network mainnet --apps=lido:QmPR28q1qWFDcd1aYjnwqpFQYkUofoyBzQ6KCHE6PSQY6P
```

What happens here: for the fork, we need to use RPC endpoint, which supports `Archived Data`, so either we use a paid Infura or you can use Alchemy.

- `--apps` - say to Aragon replacing default app link to our address. Format `appName:appAddress`. 

`appName` - Can be name of app or address like `0x3ca7c..`. If name - try to search appId from `deployed-mainnet.json` file. 

```bash
{
    ...
    "app:lido": {
        ...
        "name": "lido"     //<-search for this name
        "id": "0x3ca7c.."
        ...
    }
    ...
}
```

- appAddress - Can be `http[s]://`, IPFS CID v0 `Qm...`


If all is ok you see something like this:
```bash
 SUCCESS  Hardhat node: Started
 SUCCESS  Aragon client: starting...


Start aragon at: http://localhost:3000/#/0xb8FFC3Cd6e7Cf5a098A1c92F48009765B24088Dc
Please use `Ctrl-C` to exit this program.
```

Аfter open on the link, Aragon will need a couple of minutes to synchronize data
