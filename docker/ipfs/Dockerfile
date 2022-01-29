FROM ipfs/go-ipfs:latest

ENV IPFS_DIR="/data/ipfs"
ENV IPFS_PROFILE="server"

RUN mkdir -p $IPFS_DIR 

COPY ./entrypoint.sh .
RUN chmod +x ./entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]
