#!/bin/sh

CACHE_DIR=/export
mkdir -p $CACHE_DIR
echo "Tuning ipfs..."
/usr/local/bin/start_ipfs init
/usr/local/bin/start_ipfs bootstrap rm --all

if [ ! "$(ls -A $CACHE_DIR)" ]; then
  echo "Initializing ipfs data from snapshot"
  tar -zxf $ARAGEN_PKG -C $CACHE_DIR --strip 2 package/ipfs-cache/@aragon
  echo "Adding default Aragon assets ($ARAGEN_PKG)..."
  HASH=$(/usr/local/bin/start_ipfs add -r -Q $CACHE_DIR/@aragon | tail -1)
  echo "Asset hash: $HASH"
fi

echo "Starting ipfs..."
/usr/local/bin/start_ipfs daemon --migrate=true --enable-gc
