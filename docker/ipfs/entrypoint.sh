#!/bin/sh

CACHE_DIR=/ipfs-cache
mkdir -p $CACHE_DIR
if [ ! "$(ls -A $CACHE_DIR)" ]; then
  echo "Initializing ipfs data from snapshot"
  tar -zxf aragen.tgz -C $CACHE_DIR --strip 2 package/ipfs-cache
fi

echo "Starting ipfs..."
export IPFS_PROFILE=server
/usr/local/bin/start_ipfs bootstrap rm --all
echo "Addings assets..."
/usr/local/bin/start_ipfs add -r -Q $CACHE_DIR
/usr/local/bin/start_ipfs daemon --migrate=true
