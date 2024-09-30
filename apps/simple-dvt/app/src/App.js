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
import { SimpleDVTPrimary, SimpleDVTSecondary } from './components/SimpleDVT'

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
          primary="SimpleDVT"
        />
        <Split primary={<SimpleDVTPrimary />} secondary={<SimpleDVTSecondary />} />
      </ThemeProvider>
    </Main>
  )
}

export default App
