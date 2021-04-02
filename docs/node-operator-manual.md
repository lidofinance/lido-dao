# Node Operator Manual

This document is intended for those who wish to participate in the Lido protocol as Node Operators—entities
who run Beacon validator nodes on behalf of the protocol and receive fee in return. It consists of
two sections: [General overview](#general-overview) and [Operations HOWTO](#operations-howto).
If you’re here for the technical details of interacting with the protocol, feel free to skip to
the latter.


## General overview

Node Operators manage a secure and stable infrastructure for running Beacon validator clients
for the benefit of the protocol. They’re professional staking providers who can ensure the safety
of funds belonging to the protocol users and correctness of validator operations.

The general flow is the following:

1. A Node Operator expresses their interest to the DAO members. Their address gets proposed to the DAO vote for inclusion to the DAO's Node Operator list. Note that the Node Operator address should be supplied to the DAO with zero signing keys limit.

2. The DAO votes for including the Operator to the list of active operators. After successful
   voting for inclusion, the Node Operator becomes active.

3. The Node Operator generates and submits a set of signing public keys and associated signatures
   for future validators that will be managed by the Operator. When generating the signatures, the
   Operator must use the withdrawal credentials supplied by the DAO.

4. The DAO members check the submitted keys for correctness and, if everything’s good, vote for
   approving them. After successful approval, the keys become usable by the protocol.

5. The protocol distributes the pooled Ether evenly between all active Node Operators in `32 Ether`
   chunks. When it assigns the next deposit to a Node Operator, it takes the first non-used signing
   key, as well as the accociated signature, from the Node Operator’s usable set and performs
   a deposit to the official `DepositContract`, submitting the pooled funds. At that time, the Node
   Operator should have the validator already running and configured with the public key being used.

6. From this point, the Node Operator is responsible for keeping the validator associated with
   the signing key operable and well-behaving.

7. The protocol includes Oracles that periodically report the combined Beacon balance of all
   validators launched by the protocol. When the balance increases as a result of Beacon chain
   rewards, a fee is taken from the amount of rewards (see below for the details on how the fee
   is nominated) and distributed between active Node Operators.

### The fee

The fee is taken as a percentage from Beacon chain rewards at the moment the Oracles report
those rewards. Oracles do that once in a while—the exact period is decided by the DAO members
via the voting process.

The total fee percentage, as well as the percentage that goes to all Node Operators, is also decided
by the DAO voting and can be changed during the lifetime of the DAO. The Node Operators’ part of the
fee is distributed between the active Node Operators proportionally to the number of validators that
each Node Operator runs.

> For example, if Oracles report that the protocol has received 10 Ether as a reward, the fee
> percentage that goes to Operators is `10%`, and there are two active Node Operators, running
> `2` and `8` validators, respectively, then the first operator will receive `0.2` StETH, the
> second — `0.8` StETH.

The fee is nominated in StETH, a liquid version of ETH2 token introduced by the Lido protocol. The
tokens correspond 1:1 to the Ether that the token holder would be able get by burning their StETH
if transfers were already enabled in the Beacon chain. At any time point, the total amount of StETH
tokens is equal to the total amount of Ether controlled by the protocol on both ETH1 and ETH2 sides.

When a user submits Ether to the pool, they get the same amount of freshly-minted StETH tokens.
When reward is received on the ETH2 side, each StETH holder’s balance increases by the same
percentage that the total amount of protocol-controlled Ether has increased, corrected for the
protocol fee which is taken by [minting new StETH tokens] to the fee recipients.

> For example, if the reward has increased the total amount of protocol-controlled Ether by `10%`,
> and the total protocol fee percentage is `10%`, then each token holder’s balance will grow by
> approximately `9.09%`, and `10%` of the reward will be forwarded to the treasury, insurance fund
> and Node Operators.

One side effect of this is that you, as a Node Operator, will continue receiving the percentage
of protocol rewards even after you stop actively validating, if you chose to hold StETH received
as a fee.

[minting new StETH tokens]: https://github.com/lidofinance/lido-dao/blob/971ac8f/contracts/0.4.24/Lido.sol#L576


## Operations HOWTO

Becoming a Lido Node Operator involves several steps, all of which are detailed below.


### Expressing interest to the DAO holders

To include a Node Operator to the protocol, DAO holders must perform a voting. A Node Operator
is defined by an address that is used for two purposes:

1. The protocol pays the fee by minting StETH tokens to this address.
2. The Node Operator uses this address for submitting signing keys to be used by the protocol.

Pass this address to the DAO holders along with the other relevant information.


### Generating signing keys

Upon inclusion into the protocol, a Node Operator should generate and submit a set of [BLS12-381]
public keys that will be used by the protocol for making Beacon deposits. Along with the keys,
a Node Operator submits a set of the corresponding signatures [as defined in the spec]. The
`DepositMessage` used for generating the signature must be the following:

* `pubkey` must be derived from the private key used for signing the message;
* `amount` must equal to 32 Ether;
* `withdrawal_credentials` must equal to the protocol credentials set by the DAO.

The fork version used for generating the signature must correspond to the fork version of the Beacon
chain the instance of Lido protocol is targeted to.

You can obtain the protocol withdrawal credentials by calling [`Lido.getWithdrawalCredentials()`].
On the [Etherscan page for the Prater-deployed Lido], it’s the field number 19. The ABI of the
`Lido` contract can be found in [`lib/abi/Lido.json`].

[BLS12-381]: https://ethresear.ch/t/pragmatic-signature-aggregation-with-bls/2105
[as defined in the spec]: https://github.com/ethereum/annotated-spec/blob/master/phase0/beacon-chain.md#depositmessage
[`Lido.getWithdrawalCredentials()`]: https://github.com/lidofinance/lido-dao/blob/971ac8f/contracts/0.4.24/Lido.sol#L312
[Etherscan page for the Prater-deployed Lido]: https://goerli.etherscan.io/address/0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F#readProxyContract
[`lib/abi/Lido.json`]: https://github.com/lidofinance/lido-dao/blob/971ac8f/lib/abi/Lido.json

#### Using the forked eth2.0-deposit-cli

In a testnet environment, you can use [a fork of `eth2.0-deposit-cli`] which is also published to the
Docker Hub as [`lidofinance/deposit-cli`]. It is modified to support passing a pre-defined withdrawal
public key instead of generating new one. The withdrawal public key is not currently accessible on
the `Lido` contract instance, but you can get the key from one of the DAO holders and verify that it
matches the withdrawal credentials obtained from the `Lido` contract instance.

To generate the keys and signatures, run the following:

```sh
docker run -it --rm -v "$(pwd):/data" lidofinance/deposit-cli \
  new-mnemonic \
  --folder /data \
  --chain="$CHAIN_NAME" \
  --withdrawal_credentials="$WITHDRAWAL_CREDENTIALS"
```

Here, `CHAIN_NAME` is one of the public Beacon chain names (run the container with the `--help` flag
to see the possible values) and `WITHDRAWAL_CREDENTIALS` is the withdrawal credentials
from the protocol documentation.

As a result of running this, the `validator_keys` directory will be created in the current working
directory. It will contain a deposit data file named `deposit-data-*.json` and a number of private key
stores named `keystore-*.json`, the latter encrypted with the password you were asked for when running
the command.

If you chose to use the UI for submitting the keys, you’ll need to pass the JSON data found in the
deposit data file to the protocol (see the next section). If you wish, you can remove any other
fields except `pubkey` and `signature` from the array items.

Never share the generated mnemonic and your private keys with anyone, including the protocol members
and DAO holders.

[a fork of `eth2.0-deposit-cli`]: https://github.com/lidofinance/eth2.0-deposit-cli
[`lidofinance/deposit-cli`]: https://hub.docker.com/repository/docker/lidofinance/deposit-cli


### Submitting the keys

After generating the keys, a Node Operator submits them to the protocol. To do this, they send a
transaction from the Node Operator’s withdrawa address to the `NodeOperatorsRegistry` contract
instance, calling [`addSigningKeysOperatorBH` function] and with the following arguments:

```
* `uint256 _operator_id` the zero-based sequence number of the operator in the list.
* `uint256 _quantity` the number of keys being submitted.
* `bytes _pubkeys` the concatenated keys.
* `bytes _signatures` the concatenated signatures.
```

The address of the `NodeOperatorsRegistry` contract instance can be obtained by calling the
[`getOperators()` function] on the `Lido` contract instance. The ABI of the `NodeOperatorsRegistry`
contract can be found in [`lib/abi/NodeOperatorsRegistry.json`].

Operator ID for a given reward address can be obtained by successively calling
[`NodeOperatorsRegistry.getNodeOperator`] with the increasing `_id` argument until you get the
operator with the matching `rewardAddress`.

Etherscan pages for the Görli/Prater contracts:

* [`Lido`](https://goerli.etherscan.io/address/0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F#readProxyContract)
* [`NodeOperatorsRegistry`](https://goerli.etherscan.io/address/0x9D4AF1Ee19Dad8857db3a45B0374c81c8A1C6320)

[`addSigningKeysOperatorBH` function]: https://github.com/lidofinance/lido-dao/blob/971ac8f/contracts/0.4.24/nos/NodeOperatorsRegistry.sol#L250
[`getOperators()` function]: https://github.com/lidofinance/lido-dao/blob/971ac8f/contracts/0.4.24/Lido.sol#L361
[`lib/abi/NodeOperatorsRegistry.json`]: https://github.com/lidofinance/lido-dao/blob/971ac8f/lib/abi/NodeOperatorsRegistry.json
[`NodeOperatorsRegistry.getNodeOperator`]: https://github.com/lidofinance/lido-dao/blob/971ac8f/contracts/0.4.24/nos/NodeOperatorsRegistry.sol#L335

#### Using the key submitter UI

Lido has the specialized [web interface for submitting the keys].

<img width="1280" alt="image" src="https://user-images.githubusercontent.com/4445523/113226738-8b522480-9299-11eb-84eb-186bb6f198dc.png">

Prepare a JSON data of the following structure and paste it to the textarea that will appear in the center of the screen:

```js
[
   {
     "pubkey": "PUBLIC_KEY_1",
     "signature": "SIGNATURE_1"
   },
   {
     "pubkey": "PUBLIC_KEY_2",
     "signature": "SIGNATURE_2"
   },
   // ... etc.
]
```

If you’ve used the forked `eth2.0-deposit-cli`, you can paste the content of the generated
`deposit-data-*.json` file as-is.

Click `Check` button, and then the interface would run required checks connect the MetaMask and click `Submit` button.

Once the keys are submitted, Node Operators can check whether the supplied keys are valid with the [web interface for checking the submitted keys]. If the keys are valid, they can vote for increasing the key limit for the Node Operator.

* [web interface for submitting the keys](https://stake.testnet.lido.fi/key-checker/submit)
* [web interface for checking the submitted keys](https://stake.testnet.lido.fi/key-checker/existing)

#### Using the Aragon UI

Alternatively, you can use the Node Operators Registry app UI for submitting the keys. For the
Görli/Prater deployment, you can find it here:

https://testnet.lido.fi/#/lido-testnet-prater/0x9d4af1ee19dad8857db3a45b0374c81c8a1c6320/

Make sure you’re using a browser that exposes a Web3 provider allowing to sign transactions on
behalf of the Node Operator’s reward address. Press the Connect account button in the top-right and
allow the access to the account associated with the reward address. Then, find yourself in the
list of Node Operators — the corresponding item will be suffixed by `(you)`:

<img width="1124" alt="add-signing-keys-1" src="https://user-images.githubusercontent.com/1699593/100355848-7f143d00-3003-11eb-9d63-94630e059eb8.png">

Then, press the `...` button on the right of the item and select `add my signing keys`:

<img width="1123" alt="add-signing-keys-2" src="https://user-images.githubusercontent.com/1699593/100355837-7d4a7980-3003-11eb-84ae-02a71f9ed2ec.png">

Prepare a JSON data of the following structure and paste it to the `JSON` field in the side panel
that will appear on the right:

```js
[
   {
     "pubkey": "PUBLIC_KEY_1",
     "signature": "SIGNATURE_1"
   },
   {
     "pubkey": "PUBLIC_KEY_2",
     "signature": "SIGNATURE_2"
   },
   // ... etc.
]
```

If you’ve used the forked `eth2.0-deposit-cli`, you can paste the content of the generated
`deposit-data-*.json` file as-is.

Then, press `Add signing keys` and sign the transaction. Wait for it to be included in a block,
refresh the page and make sure that the number in the `Total` field corresponds to the number
of the keys you’ve just submitted:

<img width="1125" alt="add-signing-keys-3" src="https://user-images.githubusercontent.com/1699593/100355828-7ae81f80-3003-11eb-9d04-d29ae57c0904.png">


### Importing the keys to a Lighthouse validator client

If you’ve used the forked `eth2.0-deposit-cli` to generate the keys, you can import them to a
Lighthouse validator client by running this command:

```
docker run --rm -it \
  --name validator_keys_import \
  -v "$KEYS_DIR":/root/validator_keys \
  -v "$DATA_DIR":/root/.lighthouse \
  sigp/lighthouse \
  lighthouse account validator import \
  --reuse-password \
  --network "$TESTNET_NAME" \
  --datadir /root/.lighthouse/data \
  --directory /root/validator_keys
```
