#!/usr/bin/env sh

DATA_DIR=${DATA_DIR:-"/data"}
GAS_LIMIT=${GAS_LIMIT:-"8000000"}
GAS_PRICE=${GAS_PRICE:-"1000000000"}
NETWORK_ID=${NETWORK_ID:-"2020"}

if [ ! "$(ls -A $DATA_DIR)" ]; then
  echo "Init from custom genesis"
  geth --nousb init --datadir $DATA_DIR /root/genesis.json
  cp -R /root/keystore $DATA_DIR
fi

UNLOCK="0xb4124ceb3451635dacedd11767f004d8a28c6ee7,0x8401eb5ff34cc943f096a32ef3d5113febe8d4eb,0x306469457266cbbe7c0505e8aad358622235e768,0xd873f6dc68e3057e4b7da74c6b304d0ef0b484c7,0xdcc5dd922fb1d0fd0c450a0636a8ce827521f0ed,0x27e9727fd9b8cdddd0854f56712ad9df647fab74,0x9766d2e7ffde358ad0a40bb87c4b88d9fac3f4dd,0xbd7055ab500cd1b0b0b14c82bdbe83adcc2e8d06,0xe8898a4e589457d979da4d1bdc35ec2aaf5a3f8e,0xed6a91b1cfaae9882875614170cbc989fc5efbf0,0xcecfc058db458c00d0e89d39b2f5e6ef0a473114,0x994e37f11c5e1a156a1d072de713f15d037349d4,0xf1d805d3147c532487edd2c143e0adfa5e1cadd6,0x78407b8dc0163cee98060b02ed2fb4c72673a47e,0x857dd3b3eb0624c53773299a31ecfc260cf8f5b2,0xfb312fada4487a9f616986ff4a78beeb8f564e31,0x380ed8bd696c78395fb1961bda42739d2f5242a1,0xb7f4dc02ae7f8c7032be466804402b710e78045e,0xee918d0aba7dee86097001e8898e6a49331beae8,0x05c23b938a85ab26a36e6314a0d02080e9ca6bed,0xb97ea2e3f31f534e3be8a2f09183e61f5401476c,0x1ea2ebb132abd1157831fee038f31a39674b9992,0x954a04ca5e9ac81369be94d184205ac2c054a4ab,0x5706399c1b310481acbd7a04258bd27db1fcf433,0x9130f882353450915fa06d114b9428d935ee8928,0x7c3e5c6cdf9d0dc46b5eea2be380e275806231ff,0x9627e7ccd1935c2dc2e8b02e2f5fa364d81f42f6,0xc87a9e097e2eb4ac366cebe06ebfd8c28152f05b,0x330bd6d022de364093b8800a3d9ab4882febbc9f,0x9bbeed356e3f2e6b6d4bb92f018da2e3376c401b,0x656e544deab532e9f5b8b8079b3809aa1757fb0d,0xcf69181afe6b75366d169d9b94f68d90e365cc87,0xf2de2b2dd8881de68390da81edc6ab93c8e13291,0xf064ce2c7cae6760a227fe26da4c0f8383ca62ae,0xcfde8f47215a147e3876efa0c059771159c4fc70,0x11eb819a4706d8d282c90cffa3afe1b3f53b76e4,0x55ad6d1627ac0b512e35269bae995760d22caeac,0x2d41bd43f94dc71df361b0fca19daab9657e7838,0xe633c64928e1583f3d0fd6d9827ba23d2200fa77,0x65766bc20ad7ee2d2a40932c844ce2e52dff1ea4,0x2962b12581d93e2c239000c7f73bd247f35f8b71,0x7b393c35b9236b897973c01c0b7c77edf5be5111,0x7ee1b2159eb1b592d2567ec1da6c3f4103b6c55e,0xbc1fc9461636e30e8847040ad38c0027d54ad582,0xd64fa3aa5a6f807e008e87fbf03dcdf4aa0e9fa4,0xba314cb34ff760b8d98467895c2061165dc9573f,0xb6cc8668b1a605d16ff36a756fb7b11897762e7d,0x7f50143c3355889ea09b249083f469a840ae3bd9,0x6b302f9b9d9c3b93ca51ba72d815c7d9b05c38ab,0xb323730eab8c402b7d7bdc30acbe2f4927e3cde6"
echo "Starting geth..."
geth --nousb \
  --ipcdisable \
  --nodiscover \
  --maxpeers 0 \
  --nat none \
  --datadir /data \
  --mine \
  --miner.gaslimit "$GAS_LIMIT" \
  --miner.gasprice "$GAS_PRICE" \
  --networkid "$NETWORK_ID" \
  --allow-insecure-unlock \
  --http \
  --http.addr 0.0.0.0 \
  --http.corsdomain '*' \
  --http.vhosts '*' \
  --http.api 'eth,net,web3,personal,debug' \
  --ws \
  --ws.addr 0.0.0.0 \
  --ws.port 8546 \
  --ws.origins '*' \
  --ws.api 'eth,net,web3' \
  --exitwhensynced \
  --syncmode full \
  --gcmode archive \
  --vmdebug \
  --password /root/password.txt \
  --unlock "$UNLOCK"