FROM node:12


RUN mkdir -p /aragon
RUN wget -q https://github.com/aragon/aragon/archive/0.8.14.tar.gz
RUN tar -xzf -C /aragon 0.8.14.tar.gz
WORKDIR /aragon
#RUN cd go-ipfs && ./install.sh
#RUN rm -rf go-ipfs
#RUN ipfs init --profile server

# get aragen snapshot
RUN wget -q https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG
RUN mv $ARAGEN_PKG aragen.tgz
#RUN mkdir -p /ipfs-cache
# extract ipfs cache
#RUN tar -xzf aragen.tgz -C /ipfs-cache --strip 2 package/ipfs-cache
#RUN ipfs add -r -Q /ipfs-cache

#depositcontract
RUN apt-get update && apt-get -y install jq && apt-get clean
RUN wget -q https://raw.githubusercontent.com/ethereum/eth2.0-specs/dev/solidity_deposit_contract/deposit_contract.json

COPY ./entrypoint.sh .
ENTRYPOINT ["./entrypoint.sh"]