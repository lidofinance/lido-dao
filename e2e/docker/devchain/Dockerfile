FROM trufflesuite/ganache-cli:latest

ARG ARAGEN_PKG="aragen-5.4.3.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG
ENV DATA_DIR="/data"
ENV ARAGEN_DIR="/aragen"

RUN mkdir -p $DATA_DIR && mkdir -p $ARAGEN_DIR
# get aragen snapshot
RUN wget -O $ARAGEN_PKG https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG \
  && tar -xzf $ARAGEN_PKG -C $ARAGEN_DIR --strip 2 package/aragon-ganache || : \
  && rm $ARAGEN_PKG

COPY ./entrypoint.sh .
RUN chmod +x ./entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]