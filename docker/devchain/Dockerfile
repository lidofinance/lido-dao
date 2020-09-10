FROM node:12

ARG ARAGEN_PKG="aragen-5.4.2.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG

# install ganache-cli globally
RUN npm install -g ganache-cli --no-optional
#ipfs
RUN wget -q https://dist.ipfs.io/go-ipfs/v0.6.0/go-ipfs_v0.6.0_linux-amd64.tar.gz
RUN tar -xzf go-ipfs_v0.6.0_linux-amd64.tar.gz
RUN cd go-ipfs && ./install.sh
RUN rm -rf go-ipfs
RUN ipfs init --profile server

# get aragen snapshot
RUN wget -q https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG
RUN mv $ARAGEN_PKG aragen.tgz
RUN mkdir -p /ipfs-cache
RUN tar -xzf aragen.tgz -C /ipfs-cache --strip 2 package/ipfs-cache
RUN ipfs add -r -Q /ipfs-cache

#depositcontract
RUN apt-get update && apt-get -y install jq && apt-get clean
RUN wget -q https://raw.githubusercontent.com/ethereum/eth2.0-specs/dev/solidity_deposit_contract/deposit_contract.json

COPY ./entrypoint.sh .
ENTRYPOINT ["./entrypoint.sh"]