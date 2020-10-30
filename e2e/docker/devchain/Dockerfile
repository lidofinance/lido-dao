FROM trufflesuite/ganache-cli:latest

ARG ARAGEN_PKG="aragen-5.4.3.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG

COPY ./entrypoint.sh .
ENTRYPOINT ["./entrypoint.sh"]