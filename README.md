# DePool DAO smart contracts

## Development

### Requirements 

* NodeJs 12
* (optional) Lerna

### Installing Aragon & other deps

Installation is local and don't require root privileges.

If you have `lerna` installed globally
```bash
npm run bootstrap
```

otherwise

```bash
npx lerna bootstrap 
```

### Starting & stopping e2e environment

Three process have to be online during development: devchain (ganache), ipfs daemon, front-end:

```bash
./startup.sh
```

To stop use:

```bash
./shutdown.sh
```

### Build & test all our apps

Unit tests

```bash
npm run test
```

E2E tests

```bash
npm run test:e2e
```

#### Gas meter

In an app folder:

```bash
npm run test:gas
```

### _(deprecated)_ Configuration

Can be specified in a local file `.dev.env`.

For options see [dev.env.default](dev.env.default).

The configuration is read only during new dao deployment.


### _(deprecated)_ New dao creation

```bash
./bin/deploy-dev-contracts.sh
```

The GUI for the created DAO can be accessed at `http://localhost:3000/?#/<dao_address>/`.

Note: `DAO_ID` must be unique in a blockchain.

### Other

To reset the devchain state, stop the processes and use:

```bash
./shutdown.sh && ./startup.sh
```

or to clean restart

```bash
./startup.sh -r
```

To see other startup options:

```bash
./startup.sh -h
```
