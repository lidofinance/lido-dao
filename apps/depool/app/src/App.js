import React from 'react'
import { useAragonApi } from '@aragon/api-react'
import { Box, GU, Header, Main, SyncIndicator, textStyle } from '@aragon/ui'
import { getFee } from './api'

export default function App() {
  const {
    api,
    appState,
    path,
    requestPath,
    currentApp,
    guiStyle,
  } = useAragonApi()
  const {
    isSyncing,
    fee,
    feeDistribution,
    withdrawalCredentials,
    bufferedEther,
    totalControlledEther,
    token,
    validatorRegistrationContract,
    oracle,
    SPs,
    treasury,
    insuranceFund,
    ether2Stat,
  } = appState

  const { appearance } = guiStyle
  const appName = (currentApp && currentApp.name) || 'app'
  const version = 'v0.0.1'

  const get = () => {
    console.log(currentApp)
    getFee().then(console.log).catch(console.log)
  }
  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header primary={appName.toUpperCase()} secondary={version} />
      <Box>
        <button onClick={get}>get</button>
        <pre>{JSON.stringify(appState, null, 2)}</pre>
      </Box>
    </Main>
  )
}
