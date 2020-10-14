#!/bin/sh

IPFS_DIR=/data/ipfs
CACHE_DIR=/export
mkdir -p $CACHE_DIR

if [ ! -d $IPFS_DIR ] || [ ! "$(ls -A $IPFS_DIR)" ]; then
  echo "Tuning ipfs..."
  # /usr/local/bin/start_ipfs init
  /usr/local/bin/start_ipfs bootstrap rm --all
  chmod -R ugo+wrX $IPFS_DIR
  if [ ! "$(ls -A $CACHE_DIR)" ]; then
    echo "Initializing ipfs data from Aragen snapshot"
    tar -zxf $ARAGEN_PKG -C $CACHE_DIR --strip 2 package/ipfs-cache/@aragon
    echo "Adding default Aragon assets ($ARAGEN_PKG)..."
    HASH=$(/usr/local/bin/start_ipfs add -r -Q $CACHE_DIR/@aragon | tail -1)
    echo "Asset hash: $HASH"
  fi
fi

echo "Starting ipfs..."
/usr/local/bin/start_ipfs daemon --migrate=true --enable-gc
