# Oracle Operator Manual

This document is intended for those who wish to participate in the Lido protocol as Oracle—an entity who runs a daemon synchronizing state from ETH2 to ETH1 part of the protocol. To be precise, the daemon fetches the number of validators participating in the protocol, as well as their combined balance, from the Beacon chain and submits this data to the `LidoOracle` ETH1 smart contract.

## TL;DR

1. Generate an Ethereum address and propose it as oracle address via the "Add Member" button [in the app UI].
2. Facilitate the DAO members to approve your oracle address.
3. Launch and sync Ethereum 1.0 node pointed to Goerli with JSON-RPC endpoint enabled.
4. Launch and sync Lighthouse node pointed to Pyrmont with RPC endpoint enabled (Prysm is not yet supported).
5. Launch the oracle daemon as a docker container:

    ```sh
    docker run -d --name lido-oracle \
      --env "ETH1_NODE=http://$ETH1_NODE_RPC_ADDRESS" \
      --env "ETH2_NODE=http://$ETH2_NODE_RPC_ADDRESS" \
      --env "LIDO_CONTRACT=0xE9c991d2c9Ac29b041C8D05484C2104bD00CFF4b" \
      --env "MANAGER_PRIV_KEY=$ORACLE_ADDRESS_0X_PREFIXED" \
      lidofinance/oracle:latest \
        --daemon \
        --submit-tx
    ```

Here, `ORACLE_ADDRESS_0X_PREFIXED` should be populated with the address from step 1.

[in the app UI]: https://goerli.lido.fi/#/lido-dao-testnet/0x8aa931352fedc2a5a5b3e20ed3a546414e40d86c

## Intro

Total supply of the StETH token always corresponds to the amount of Ether in control of the protocol. It increases on user deposits and Beacon chain staking rewards, and decreases on Beacon chain penalties and slashings. Since the Beacon chain is a separate chain, Lido ETH1 smart contracts can’t get direct access to its data.

Communication between Ethereum 1.0 part of the system and the Beacon network is performed by the DAO-assigned oracles. They monitor staking providers’ Beacon chain accounts and submit corresponding data to the `LidoOracle` contract. The latter takes care of making sure that quorum
about the data being pushed is reached within the oracles and enforcing data submission order (so that oracle contract never pushes data that is older than the already pushed one).

Upon every update submitted by the `LidoOracle` contract, the system recalculates the total StETH token balance. If the overall staking rewards are bigger than the slashing penalties, the system registers profit, and fee is taken from the profit and distributed between the insurance fund,
the treasury, and node operators.

## Prerequisites

In order to launch oracle daemon on your machine, you need to have several things:

1. A synced Ethereum 1.0 client pointed to the Görli testnet and with JSON-RPC endpoint enabled.
2. A synced Lighthouse client pointed to Pyrmont testnet and with RPC endpoint enabled (Prysm client not yet supported).
3) An address that’s added to the approved oracles list here: https://goerli.lido.fi/#/lido-dao-testnet/0x8aa931352fedc2a5a5b3e20ed3a546414e40d86c. You have to initiate the DAO voting on adding your address there by pressing the "Add Member" button.

## The oracle daemon

The oracle daemon is a simple python app that watches the Beacon chain and pushes the data to the [Oracle Smart Contract](https://goerli.etherscan.io/address/0x8aA931352fEdC2A5a5b3E20ed3A546414E40D86C).

The oracle source code is available at https://github.com/lidofinance/lido-oracle. The docker image is available in the public Docker Hub registry: https://hub.docker.com/r/lidofinance/oracle.

The algorithm of the above oracle implementation is simple: at each step of an infinite loop, the daemon fetches the reportable epoch from the Oracle contract, and if this epoch is finalized on the Beacon chain, pushes the data to the Oracle contract by submitting a transaction. The transaction contains a tuple:

```text
(
  epoch,
  sum_of_balances_of_lido_validators,
  number_of_lido_validators_on_beacon
)
```

Keep in mind that some of these transactions may revert. This happens when a transaction finalizing the current frame gets included in a block before your oracle's transaction. For example, such a transaction might already be submitted (but not included in a block) when your oracle fetched the current reportable epoch.

#### Environment variables

The oracle daemon requires the following environment variables:

* `ETH1_NODE` the ETH1 JSON-RPC endpoint
* `ETH2_NODE` the Lighthouse RPC endpoint
* `LIDO_CONTRACT` the address of the Lido contract (`0xE9c991d2c9Ac29b041C8D05484C2104bD00CFF4b` in Görli/Pyrmont)
* `MANAGER_PRIV_KEY` 0x-prefixed private key of the address used by the oracle (should be in the DAO-approved list)

#### Running the daemon

You can use the public Docker image ro launch the daemon:

```sh
docker run -d --name lido-oracle \
  --env "ETH1_NODE=http://$ETH1_NODE_RPC_ADDRESS" \
  --env "ETH2_NODE=http://$ETH2_NODE_RPC_ADDRESS" \
  --env "LIDO_CONTRACT=0xE9c991d2c9Ac29b041C8D05484C2104bD00CFF4b" \
  --env "MANAGER_PRIV_KEY=$ORACLE_ADDRESS_0X_PREFIXED" \
  lidofinance/oracle:latest \
    --daemon \
    --submit-tx
```

This will start the oracle in daemon mode. You can also run it in a one-off mode, for example if you'd prefer to trigger oracle execution as a `cron` job. In this case, skip passing the `--daemon` flag to the oracle (and the `-d` flag to `docker run`).

To skip sending the transaction and just see what oracle is going to report, don't pass the `--submit-tx` flag:

```sh
docker run --rm \
  --env "ETH1_NODE=http://$ETH1_NODE_RPC_ADDRESS" \
  --env "ETH2_NODE=http://$ETH2_NODE_RPC_ADDRESS" \
  --env "LIDO_CONTRACT=0xE9c991d2c9Ac29b041C8D05484C2104bD00CFF4b" \
  --env "MANAGER_PRIV_KEY=$ORACLE_ADDRESS_0X_PREFIXED" \
  lidofinance/oracle:latest
```
