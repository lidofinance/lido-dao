import getDeployedParam from './getDeployed'

export const KERNEL_CORE_APP_ID = '0x3b4bf6bf3ad5000ecf0f989d5befde585c6860fea3e574a4fab4c49d1c177d9c'
export const KERNEL_DEFAULT_ACL_APP_ID = '0xe3262375f45a6e2026b7e7b18c2b807434f2508fe1a2a3dfb493c7df8f4aad6a'
export const KERNEL_DEFAULT_VAULT_APP_ID = '0x7e852e0fcfce6551c13800f1e7476f982525c2b5277ba14b24339c68416336d1'
export const EVMSCRIPT_REGISTRY_APP_ID = '0xddbcfd564f642ab5627cf68b9b7d374fb4f8a36e941a75d89c87998cef03bd61'
export const AGENT_APP_ID = getDeployedParam('aragon_app_agent_id')
export const VAULT_APP_ID = getDeployedParam('aragon_app_vault_id')
export const VOTING_APP_ID = getDeployedParam('aragon_app_voting_id')
export const FINANCE_APP_ID = getDeployedParam('aragon_app_finance_id')
export const TOKEN_MANAGER_APP_ID = getDeployedParam('aragon_app_token-manager_id')

// lido
export const STETH_APP_ID = getDeployedParam('lido_app_steth_id')
export const LIDOORACLE_APP_ID = getDeployedParam('lido_app_lidooracle_id')
export const LIDO_APP_ID = getDeployedParam('lido_app_lido_id')
export const NODE_OPERATORS_REGISTRY_APP_ID = getDeployedParam('lido_app_node-operators-registry_id')

export const depositContract = getDeployedParam('depositContractAddress')
export const ensRegistry = getDeployedParam('ensAddress')
export const daoAddress = getDeployedParam('daoAddress')
export const daoName = getDeployedParam('daoName') + '.' + getDeployedParam('aragonIDEnsNodeName')
export const owner = getDeployedParam('owner')
export const cstETHAddress = getDeployedParam('cstEthAddress')

// TODO naming wrappers for logger purpose
// permissions
export const MANAGE_WITHDRAWAL_KEY = '0x96088a8483023eb2f67b12aabbaf17d1d055e6ef387e563902adc1bba1e4028b'
export const MANAGE_SIGNING_KEYS = '0x75abc64490e17b40ea1e66691c3eb493647b24430b358bd87ec3e5127f1621ee'
export const ADD_NODE_OPERATOR_ROLE = '0xe9367af2d321a2fc8d9c8f1e67f0fc1e2adf2f9844fb89ffa212619c713685b2'
export const SET_NODE_OPERATOR_NAME_ROLE = '0x58412970477f41493548d908d4307dfca38391d6bc001d56ffef86bd4f4a72e8'
export const SET_NODE_OPERATOR_ACTIVE_ROLE = '0xd856e115ac9805c675a51831fa7d8ce01c333d666b0e34b3fc29833b7c68936a'
export const SET_NODE_OPERATOR_ADDRESS_ROLE = '0xbf4b1c236312ab76e456c7a8cca624bd2f86c74a4f8e09b3a26d60b1ce492183'
export const SET_NODE_OPERATOR_LIMIT_ROLE = '0x07b39e0faf2521001ae4e58cb9ffd3840a63e205d288dc9c93c3774f0d794754'
export const REPORT_STOPPED_VALIDATORS_ROLE = '0x18ad851afd4930ecc8d243c8869bd91583210624f3f1572e99ee8b450315c80f'
export const SET_ORACLE = '0x11eba3f259e2be865238d718fd308257e3874ad4b3a642ea3af386a4eea190bd'
export const MANAGE_MEMBERS = '0xbf6336045918ae0015f4cdb3441a2fdbfaa4bcde6558c8692aac7f56c69fb067'
export const MANAGE_QUORUM = '0xa5ffa9f45fa52c446078e834e1914561bd9c2ab1e833572d62af775da092ccbc'

export const UNLIMITED_STAKING_LIMIT = 1000000000
export const ZERO_ADDRESS = '0x' + '0'.repeat(40)

// fee 100% = 10000
export const BASIC_FEE = 1000
export const TREASURY_FEE = 0
export const INSURANCE_FEE = 5000
export const NODE_OPERATOR_BASIC_FEE = 5000
export const USER_REWARDS = 10000 - BASIC_FEE

// accounts
export const holderAccounts = [
  '0xb4124cEB3451635DAcedd11767f004d8a28c6eE7', // 0
  '0x8401Eb5ff34cc943f096A32EF3d5113FEbE8D4Eb', // 1
  '0x306469457266CBBe7c0505e8Aad358622235e768' // 2
  // '0xd873F6DC68e3057e4B7da74c6b304d0eF0B484C7', // 3
  // '0xDcC5dD922fb1D0fd0c450a0636a8cE827521f0eD' // 4
]

export const nosAccounts = [
  '0x27E9727FD9b8CdDdd0854F56712AD9DF647FaB74', // 5
  '0x9766D2e7FFde358AD0A40BB87c4B88D9FAC3F4dd', // 6
  '0xBd7055AB500cD1b0b0B14c82BdBe83ADCc2e8D06', // 7
  '0xe8898A4E589457D979Da4d1BDc35eC2aaf5a3f8E', // 8
  '0xED6A91b1CFaae9882875614170CbC989fc5EfBF0' // 9
]

export const oracleAccounts = [
  '0xBd7055AB500cD1b0b0B14c82BdBe83ADCc2e8D06', // 7
  '0xe8898A4E589457D979Da4d1BDc35eC2aaf5a3f8E', // 8
  '0xED6A91b1CFaae9882875614170CbC989fc5EfBF0' // 9

  // '0xceCFc058DB458c00d0e89D39B2F5e6EF0A473114',
  // '0x994e37F11c5E1A156a1d072De713f15D037349d4',
  // '0xF1D805D3147C532487edd2c143e0AdfA5E1caDD6',
  // '0x78407b8DC0163cee98060B02ed2fb4c72673a47E',
  // '0x857DD3b3EB0624c53773299A31ECFC260cf8F5b2'
]

export const simpleAccounts = [
  '0xFb312FAda4487a9F616986FF4a78bEEb8f564e31',
  '0x380ed8Bd696c78395Fb1961BDa42739D2f5242a1',
  '0xb7F4Dc02ae7f8C7032BE466804402B710E78045E',
  '0xEe918D0aBa7dEe86097001E8898E6a49331BEAe8',
  '0x05c23b938a85ab26A36E6314a0D02080E9ca6BeD'
]
