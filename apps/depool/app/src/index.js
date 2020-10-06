import 'core-js/stable'
import 'regenerator-runtime/runtime'

import React from 'react'
import ReactDOM from 'react-dom'
import { AragonApi } from '@aragon/api-react'
import App from './App'

const defaultValue = ''

const defaultState = {
  fee: defaultValue,
  feeDistribution: defaultValue,
  withdrawalCredentials: defaultValue,
  bufferedEther: defaultValue,
  totalControlledEther: defaultValue,
  token: defaultValue,
  validatorRegistrationContract: defaultValue,
  oracle: defaultValue,
  SPs: defaultValue,
  treasury: defaultValue,
  insuranceFund: defaultValue,
  ether2Stat: defaultValue,
  isSyncing: true,
}

const reducer = (state) => {
  if (state === null) {
    return defaultState
  }
  return state
}

ReactDOM.render(
  <AragonApi reducer={reducer}>
    <App />
  </AragonApi>,
  document.getElementById('root')
)
