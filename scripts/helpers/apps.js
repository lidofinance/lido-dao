// aragon
const AGENT_APP_ID = '0x9ac98dc5f995bf0211ed589ef022719d1487e5cb2bab505676f0d084c07cf89a'
// const VAULT_APP_ID = '0x7e852e0fcfce6551c13800f1e7476f982525c2b5277ba14b24339c68416336d1'
const VOTING_APP_ID = '0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4'
const FINANCE_APP_ID = '0xbf8491150dafc5dcaee5b861414dca922de09ccffa344964ae167212e8c673ae'
const TOKEN_MANAGER_APP_ID = '0x6b20a3010614eeebf2138ccec99f028a61c811b3b1a3343b6ff635985c75c91f'

// lido
const STETH_APP_ID = '0x7a155a469b6e893b1e5d8f992f066474a74daf5ece6715948667ef3565e34ec2'
const LIDOORACLE_APP_ID = '0xc62f68e3a6f657e08c27afe0f11d03375e5255f5845055d81c1281dbf139ce18'
const LIDO_APP_ID = '0xe5c0c15280069e08354c1c1d5b6706edcc4e849e76ec9822afa35d4d66bbbe06'
const STAKING_PROVIDERS_REGISTRY_APP_ID = '0x6ba226ab4c6dc8945d4ef74de1da0053b9bb7cfe8c1f4f0b88b59bfe2b8b943e'

const apps = [
  { name: 'steth', tld: 'lido.eth', contractName: 'StETH', appId: STETH_APP_ID },
  { name: 'lido', tld: 'lido.eth', contractName: 'Lido', appId: LIDO_APP_ID },
  { name: 'lidooracle', tld: 'lido.eth', contractName: 'LidoOracle', appId: LIDOORACLE_APP_ID },
  {
    name: 'staking-providers-registry',
    tld: 'lido.eth',
    contractName: 'StakingProvidersRegistry',
    appId: STAKING_PROVIDERS_REGISTRY_APP_ID
  },
  { name: 'agent', tld: 'aragonpm.eth', contractName: 'Agent', appId: AGENT_APP_ID },
  // { name: 'vault', tld: 'aragonpm.eth', contractName: 'Vault', appId: VAULT_APP_ID },
  { name: 'voting', tld: 'aragonpm.eth', contractName: 'Voting', appId: VOTING_APP_ID },
  { name: 'finance', tld: 'aragonpm.eth', contractName: 'Finance', appId: FINANCE_APP_ID },
  { name: 'token-manager', tld: 'aragonpm.eth', contractName: 'Tokens', appId: TOKEN_MANAGER_APP_ID }
]

module.exports = apps
