FROM hybridgroup/gocv
#FIXME configure with bin
WORKDIR /app
COPY . .
#Replace go dependencies in go.mod to local
WORKDIR ./dc4bc
RUN echo "replace github.com/lidofinance/kyber-bls12381 => /app/kyber-bls12381" >> go.mod
#Generating pubkey
WORKDIR ./client
RUN go test -run=TestFullFlow
#Copy generated pubKey to ./data
CMD bash -c "cp -f /tmp/participant_0.pubkey /data/ && chmod -R 666 /data/participant_0.pubkey"
