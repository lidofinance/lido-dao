# testnet for local e2e tests

### eth1 localnet contract addresses
After clean start:
  - Deposit contract: `0x5f4e510503d83bd1a5436bdae2923489da0be454` deployed at block `70`
  - ENS: `0x5f6f7e8cc7346a11ca2def8f827b7a0b612c56a1`
  - DAO_FACTORY: `0x5d94e3e7aec542ab0f9129b9a7badeb5b3ca0f77`
  - MINIME_FACTORY: `0xd526b7aba39cccf76422835e7fd5327b98ad73c9`
  - FIFResolvingRegistrar: `0xf1f8aac64036cdd399886b1c157b7e3b361093f3`
  - Aragon APM: `aragonpm.eth` -> ``
  - DePool APM: `depoolspm.eth` -> `0x1902a0410EFe699487Dd85F12321aD672bE4ada2`
  
  app implementations:
  - DePool: `depool.depoolspm.eth` -> `0xfe18BCBeDD6f46e0DfbB3Aea02090F23ED1c4a28` [ipfs](http://localhost:8080/ipfs/QmYK2uMUzVR86A7Cxfz2yimz7bRXUGKrQRDuUkx66mh4Hm)
  - DePool Oracle: `depooloracle.depoolspm.eth` -> `0x2e25c8F88c5cCcbC9400e5bc86cF9C58C7604327` [ipfs](http://localhost:8080/ipfs/QmbCTi3DY8vR17V11QgxuUzxApFnJgu4cUYLYcbphZUxiT)
  - StETH token: `steth.depoolspm.eth` -> `0x019F12a7DAa44A34CD0FF35055b0e2D4679D8521` [ipfs](http://localhost:8080/ipfs/QmV26JoDLiHjV5RRoQHCKzXYuwzgBgD5nishY2b3q3eh6a)
  - DePool DAO Template: `depool-template.depoolspm.eth` -> `0xD13a7D8A728692eB2c56135B5EB5A1951b3F8395`
  - DePool DAO: `depool-dao.aragon.id` -> `0xD20F21CEb31a8E302603dC3ff994f00aa9312A66`
  - DePool Share token: `0xf2804D07A941F77F34EEEb252D172E4268d0e9D4`

 > Depool APM: ens.addr('depoolspm.eth')
 > Depool apps: As APM repos, e.g. apm.getLatest('depool.depoolspm.eth')
 > Templates: As APM repos, e.g. apm.getLatest('depool-template.depoolspm.eth')
  

### eth1 DAO accounts
mnemonic: `explain tackle mirror kit van hammer degree position ginger unfair soup bonus`

addresses & pk: <details><summary>SHOW</summary>

  - Address #1: 0xb4124cEB3451635DAcedd11767f004d8a28c6eE7 (account used to deploy DAOs, has more permissions)   
    Private key: a8a54b2d8197bc0b19bb8a084031be71835580a01e70a45a13babd16c9bc1563

  - Address #2: 0x8401Eb5ff34cc943f096A32EF3d5113FEbE8D4Eb
    Private key: ce8e3bda3b44269c147747a373646393b1504bfcbb73fc9564f5d753d8116608
   
  - Address #3: 0x306469457266CBBe7c0505e8Aad358622235e768
    Private key: 8716d2701596f51aa39d061a685d5ae5ec946eb2c7adb059d29024b5bb3b02c8
   
  - Address #4: 0xd873F6DC68e3057e4B7da74c6b304d0eF0B484C7
    Private key: 62d7bb725787d84b059eb4950f6eea060d898183250ca3ea673a36b8e113018f

  - Address #5: 0xDcC5dD922fb1D0fd0c450a0636a8cE827521f0eD
    Private key: 705df2ae707e25fa37ca84461ac6eb83eb4921b653e98fdc594b60bea1bb4e52
   
  - Address #6: 0x27E9727FD9b8CdDdd0854F56712AD9DF647FaB74
    Private key: 6b12b45143fc6c7721d0ffbb9811905e773868376501fd1f46c64bf34ae29991

  - Address #7: 0x9766D2e7FFde358AD0A40BB87c4B88D9FAC3F4dd
    Private key: 33f3f34569f997abb165d6967895d963a2b15ec609efcec844e65b60ee8340c7

  - Address #8: 0xBd7055AB500cD1b0b0B14c82BdBe83ADCc2e8D06
    Private key: 5a013cc48f0a3196b0986fc7a7a9dd320ac75e89e33302a7ff4ea6b9dc4f7b00

  - Address #9: 0xe8898A4E589457D979Da4d1BDc35eC2aaf5a3f8E
    Private key: 418cc0b07bfef998f577384b185b97ad544204b5be43ac9b3abf16db2012ab5c

  - Address #10: 0xED6A91b1CFaae9882875614170CbC989fc5EfBF0
    Private key: 698eece6f9915b08b4d1a63958dc4f3996ee5a8d685b29d17c28beab912a77cd    
</detail>