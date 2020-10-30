FROM ipfs/go-ipfs:latest

ARG ARAGEN_PKG="aragen-5.4.3.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG
ENV IPFS_PROFILE="server"

COPY ./entrypoint.sh .
ENTRYPOINT ["./entrypoint.sh"]
