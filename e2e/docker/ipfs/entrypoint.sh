#!/bin/sh

chmod -R ugo+wrX $IPFS_DIR
# /usr/local/bin/start_ipfs init
/usr/local/bin/start_ipfs bootstrap rm --all
if [ "$(ls -A $CACHE_DIR)" ]; then
  echo "Adding default Aragon assets..."
  HASH=$(/usr/local/bin/start_ipfs add -r -Q $ARAGEN_DIR/@aragon | tail -1)
  echo "Asset hash: $HASH"
fi
chmod -R ugo+wrX $IPFS_DIR

echo "Starting ipfs..."
/usr/local/bin/start_ipfs daemon --migrate=true --enable-gc
