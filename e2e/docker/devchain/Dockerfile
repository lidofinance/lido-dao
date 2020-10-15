FROM node:12

ARG ARAGEN_PKG="aragen-5.4.3.tgz"
ENV ARAGEN_PKG=$ARAGEN_PKG

# install ganache-cli globally
RUN npm install -g ganache-cli --no-optional
# get aragen snapshot
RUN wget -q https://registry.npmjs.org/@aragon/aragen/-/$ARAGEN_PKG

COPY ./entrypoint.sh .
ENTRYPOINT ["./entrypoint.sh"]