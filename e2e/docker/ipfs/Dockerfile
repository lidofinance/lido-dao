FROM ipfs/go-ipfs:latest

ARG ARAGEN_PKG="aragen-5.4.3.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG
ENV IPFS_DIR="/data/ipfs"
ENV IPFS_PROFILE="server"
ENV ARAGEN_DIR="/aragen"

RUN mkdir -p $IPFS_DIR && mkdir -p $ARAGEN_DIR

# get aragen snapshot
RUN wget -O $ARAGEN_PKG https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG \
  && tar -zxf $ARAGEN_PKG -C $ARAGEN_DIR --strip 2 package/ipfs-cache/@aragon || : \
  && rm $ARAGEN_PKG

COPY ./entrypoint.sh .
RUN chmod +x ./entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
