// aragon
const AGENT_APP_ID = '0x9ac98dc5f995bf0211ed589ef022719d1487e5cb2bab505676f0d084c07cf89a'
// const VAULT_APP_ID = '0x7e852e0fcfce6551c13800f1e7476f982525c2b5277ba14b24339c68416336d1'
const VOTING_APP_ID = '0x9fa3927f639745e587912d4b0fea7ef9013bf93fb907d29faeab57417ba6e1d4'
const FINANCE_APP_ID = '0xbf8491150dafc5dcaee5b861414dca922de09ccffa344964ae167212e8c673ae'
const TOKEN_MANAGER_APP_ID = '0x6b20a3010614eeebf2138ccec99f028a61c811b3b1a3343b6ff635985c75c91f'

// depool
const STETH_APP_ID = '0x5937d846addd00601bf692837c2cd9854dacd2c55911625da04aec9c62a61a26'
const DEPOOLORACLE_APP_ID = '0xebe89ae11ec5a76827463bd202b0551f137fdc6dad7cd69ecdf4fe553af5f77b'
const DEPOOL_APP_ID = '0xdf4019658a996b6bc3639baa07d25c655bf826334fc5c81bb83e501905b51cb1'
const STAKING_PROVIDERS_REGISTRY_APP_ID = '0x6ca5078df26de2bcf0976b0bfba50b6ed5dac3644879214556e2789dfc78df16'

const apps = [
  { name: 'steth', tld: 'depoolspm.eth', contractName: 'StETH', appId: STETH_APP_ID },
  { name: 'depool', tld: 'depoolspm.eth', contractName: 'DePool', appId: DEPOOL_APP_ID },
  { name: 'depooloracle', tld: 'depoolspm.eth', contractName: 'DePoolOracle', appId: DEPOOLORACLE_APP_ID },
  { name: 'staking-providers-registry', tld: 'depoolspm.eth', contractName: 'StakingProvidersRegistry', appId: STAKING_PROVIDERS_REGISTRY_APP_ID },
  { name: 'agent', tld: 'aragonpm.eth', contractName: 'Agent', appId: AGENT_APP_ID },
  // { name: 'vault', tld: 'aragonpm.eth', contractName: 'Vault', appId: VAULT_APP_ID },
  { name: 'voting', tld: 'aragonpm.eth', contractName: 'Voting', appId: VOTING_APP_ID },
  { name: 'finance', tld: 'aragonpm.eth', contractName: 'Finance', appId: FINANCE_APP_ID },
  { name: 'token-manager', tld: 'aragonpm.eth', contractName: 'Tokens', appId: TOKEN_MANAGER_APP_ID }
]

module.exports = apps
