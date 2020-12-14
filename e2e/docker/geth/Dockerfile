FROM ethereum/client-go:v1.9.24

COPY ./genesis.json /root
COPY ./password.txt /root
COPY ./keystore /root/keystore
COPY ./entrypoint.sh .
RUN chmod +x ./entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]