FROM ipfs/go-ipfs:latest

ARG ARAGEN_PKG="aragen-5.4.3.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG
ENV IPFS_PROFILE="server"

# get aragen snapshot
RUN wget -q https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG

COPY ./entrypoint.sh .
ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
