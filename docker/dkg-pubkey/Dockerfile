FROM hybridgroup/gocv

#FIXME configure with bin
WORKDIR /depool-dao
COPY . .

#Generating pubkey
WORKDIR ./dc4bc/client
RUN apt update && apt install -y openssh-client

#Configure ssh
RUN mkdir -p ~/.ssh && chmod 700 ~/.ssh && git config --global url."ssh://git@github.com/".insteadOf "https://github.com/" \
&& ssh-keyscan github.com >> ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts

#Copy pubkey to ./data
CMD bash -c "go test -run=TestFullFlow && mv /tmp/dc4bc_participant_0.pubkey /data/ && chmod -R 777 /data/dc4bc_participant_0.pubkey"




