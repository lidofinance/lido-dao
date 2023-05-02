import React from 'react'
import { useAragonApi, useGuiStyle } from '@aragon/api-react'
import {
  Button,
  Header,
  Main,
  Split,
  SyncIndicator,
  useTheme,
} from '@aragon/ui'
import { ThemeProvider } from 'styled-components'
import { StakingRouterPrimary } from './components/stakingRouter'
import { CuratedPrimary, CuratedSecondary } from './components/curated'

const App = () => {
  const { appState } = useAragonApi()
  const { appearance } = useGuiStyle()
  const { isSyncing } = appState

  console.log(appState)

  const theme = useTheme()

  return (
    <Main theme={appearance}>
      <ThemeProvider theme={theme}>
        <SyncIndicator visible={isSyncing} shift={50} />
        <Header
          primary="StakingRouter"
        />
        <Split primary={<StakingRouterPrimary />} />
        <Header
          primary="Curated"
        />
        <Split primary={<CuratedPrimary />} secondary={<CuratedSecondary />} />
      </ThemeProvider>
    </Main>
  )
}

export default App
