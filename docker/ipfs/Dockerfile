FROM ipfs/go-ipfs:latest

ARG ARAGON_PKG="aragen-5.4.2.tgz"
ENV ARAGON_PKG=$ARAGON_PKG

# get aragen snapshot
RUN wget -q https://registry.npmjs.org/@aragon/aragen/-/$ARAGON_PKG
RUN mv $ARAGON_PKG aragen.tgz

COPY ./entrypoint.sh .
ENTRYPOINT ["/sbin/tini", "--", "./entrypoint.sh"]
