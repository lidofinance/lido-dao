# Oracle Operator Manual

This document is intended for those who wish to participate in the Lido protocol as Oracle—an entity who runs a daemon synchronizing state from ETH2 to ETH1 part of the protocol. To be precise, the daemon fetches the number of validators participating in the protocol, as well as their combined balance, from the Beacon chain and submits this data to the `LidoOracle` ETH1 smart contract.

## TL;DR

1. Generate an Ethereum address and propose it as an oracle address via the "Add Member" button in the app UI: [Mainnet] / [Görli].
2. Facilitate the DAO members to approve your oracle address.
3. Launch and sync an Ethereum 1.0 node with JSON-RPC endpoint enabled.
4. Launch and sync a Lighthouse node with RPC endpoint enabled (Prysm is not yet supported).
5. Launch the oracle daemon as a docker container.

[Mainnet]: https://mainnet.lido.fi/#/lido-dao/0x442af784a788a5bd6f42a01ebe9f287a871243fb/
[Görli]: https://testnet.lido.fi/#/lido-testnet-prater/0xbc0b67b4553f4cf52a913de9a6ed0057e2e758db/

## Intro

Total supply of the StETH token always corresponds to the amount of Ether in control of the protocol. It increases on user deposits and Beacon chain staking rewards, and decreases on Beacon chain penalties and slashings. Since the Beacon chain is a separate chain, Lido ETH1 smart contracts can’t get direct access to its data.

Communication between Ethereum 1.0 part of the system and the Beacon network is performed by the DAO-assigned oracles. They monitor staking providers’ Beacon chain accounts and submit corresponding data to the `LidoOracle` contract. The latter takes care of making sure that quorum about the data being pushed is reached within the oracles and enforcing data submission order (so that oracle contract never pushes data that is older than the already pushed one).

Upon every update submitted by the `LidoOracle` contract, the system recalculates the total StETH token balance. If the overall staking rewards are bigger than the slashing penalties, the system registers profit, and fee is taken from the profit and distributed between the insurance fund, the treasury, and node operators.

## Prerequisites

In order to launch oracle daemon on your machine, you need to have several things:

1. A synced Ethereum 1.0 client with JSON-RPC endpoint enabled.
2. A synced Lighthouse client with RPC endpoint enabled (Prysm client not yet supported).
3) An address that’s added to the approved oracles list here: [Mainnet] / [Görli]. You have to initiate the DAO voting on adding your address there by pressing the "Add Member" button.

[Mainnet]: https://mainnet.lido.fi/#/lido-dao/0x442af784a788a5bd6f42a01ebe9f287a871243fb/
[Görli]: https://testnet.lido.fi/#/lido-testnet-prater/0xbc0b67b4553f4cf52a913de9a6ed0057e2e758db/

## The oracle daemon

The oracle daemon is a simple Python app that watches the Beacon chain and pushes the data to the LidoOracle Smart Contract: [Mainnet](https://etherscan.io/address/0x442af784A788A5bd6F42A01Ebe9F287a871243fb) / [Görli](https://goerli.etherscan.io/address/0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F).

The oracle source code is available at https://github.com/lidofinance/lido-oracle. The docker image is available in the public Docker Hub registry: https://hub.docker.com/r/lidofinance/oracle.

The algorithm of the above oracle implementation is simple: at each step of an infinite loop, the daemon fetches the reportable epoch from the `LidoOracle` contract, and if this epoch is finalized on the Beacon chain, pushes the data to the `LidoOracle` contract by submitting a transaction. The transaction contains a tuple:

```text
(
  epoch,
  sum_of_balances_of_lido_validators,
  number_of_lido_validators_on_beacon
)
```

Keep in mind that some of these transactions may revert. This happens when a transaction finalizing the current frame gets included in a block before your oracle's transaction. For example, such a transaction might had already been submitted by another oracle (but not yet included in a block) when your oracle fetched the current reportable epoch.

#### Environment variables

The oracle daemon requires the following environment variables:

* `ETH1_NODE` for `0.1.4` or `WEB3_PROVIDER_URI` for `0.1.5-prerelease` the ETH1 JSON-RPC endpoint.
* `BEACON_NODE` the Lighthouse RPC endpoint.
* `POOL_CONTRACT` the address of the Lido contract (`0x442af784A788A5bd6F42A01Ebe9F287a871243fb` in Mainnet and `0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F` in Görli Testnet).
* `STETH_PRICE_ORACLE_CONTRACT` the address of stETH price oracle contract (`0x4522dB9A6f804cb837E5fC9F547D320Da3edD49a` in Görli Testnet).
* `STETH_CURVE_POOL_CONTRACT` the address of Curve ETH/stETH Pool (`0xCEB67769c63cfFc6C8a6c68e85aBE1Df396B7aDA` in Görli Testnet)
* `MEMBER_PRIV_KEY` 0x-prefixed private key of the address used by the oracle (should be in the DAO-approved list).
* `DAEMON` run Oracle in a daemon mode

#### Running the daemon

To run script you have to export three required env variables: `ETH1_NODE_RPC_ADDRESS`, `ETH2_NODE_RPC_ADDRESS`, `ORACLE_PRIVATE_KEY_0X_PREFIXED`
Before run daemon check that you've set all required env variables.
To run script you have to export three env variables: MEMBER_PRIV_KEY - 

You can use the public Docker image to launch the daemon.

0.1.4 for Mainnet:

```sh
docker run -d --name lido-oracle \
  --env "ETH1_NODE=http://$ETH1_NODE_RPC_ADDRESS" \
  --env "BEACON_NODE=http://$ETH2_NODE_RPC_ADDRESS" \
  --env "POOL_CONTRACT=0x442af784A788A5bd6F42A01Ebe9F287a871243fb" \
  --env "MEMBER_PRIV_KEY=$ORACLE_PRIVATE_KEY_0X_PREFIXED" \
  --env "DAEMON=1" \
  lidofinance/oracle:0.1.4
```


2.0.0-pre1 for Görli Testnet

```sh
docker run -d --name lido-oracle \
  --env "WEB3_PROVIDER_URI=$ETH1_NODE_RPC_ADDRESS" \
  --env "BEACON_NODE=$ETH2_NODE_RPC_ADDRESS" \
  --env "MEMBER_PRIV_KEY=$ORACLE_PRIVATE_KEY_0X_PREFIXED" \
  --env "POOL_CONTRACT=0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F" \
  --env "STETH_PRICE_ORACLE_CONTRACT=0x4522dB9A6f804cb837E5fC9F547D320Da3edD49a" \
  --env "STETH_CURVE_POOL_CONTRACT=0xCEB67769c63cfFc6C8a6c68e85aBE1Df396B7aDA" \
  --env "DAEMON=1" \
  lidofinance/oracle:2.0.0-pre1
```

This will start the oracle in daemon mode. You can also run it in a one-off mode, for example if you’d prefer to trigger oracle execution as a `cron` job. In this case, set the `DAEMON` environment variable to 0.