#!/bin/sh

# /usr/local/bin/start_ipfs init
/usr/local/bin/start_ipfs bootstrap rm --all
chmod -R ugo+wrX $IPFS_DIR

echo "Starting ipfs..."
/usr/local/bin/start_ipfs daemon --migrate=true --enable-gc
