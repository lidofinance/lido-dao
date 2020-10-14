FROM hybridgroup/gocv
#FIXME configure with bin
WORKDIR /depool-dao
COPY . .
#Replace go dependencies in go.mod to local
WORKDIR ./dc4bc
RUN echo "replace github.com/depools/kyber-bls12381 => /depool-dao/kyber-bls12381" >> go.mod
#Generating pubkey
WORKDIR ./client
RUN go test -run=TestFullFlow
#Copy generated pubKey to ./data
CMD bash -c "cp -f /tmp/dc4bc_participant_0.pubkey /data/ && chmod -R 666 /data/dc4bc_participant_0.pubkey"
