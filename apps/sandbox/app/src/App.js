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
import { SandBoxPrimary, SandBoxSecondary } from './components/sandbox'

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
          primary="NOR SandBox"
        />
        <Split primary={<SandBoxPrimary />} secondary={<SandBoxSecondary />} />
      </ThemeProvider>
    </Main>
  )
}

export default App
