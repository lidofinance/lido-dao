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
import { Secondary } from './components/Secondary'
import { Primary } from './components/Primary'
import { ThemeProvider } from 'styled-components'

const App = () => {
  const { appState } = useAragonApi()
  const { appearance } = useGuiStyle()
  const { isSyncing } = appState

  const theme = useTheme()

  return (
    <Main theme={appearance}>
      <ThemeProvider theme={theme}>
        <SyncIndicator visible={isSyncing} shift={50} />
        <Header
          primary="Lido Curated Module"
          secondary={<Button mode="strong" label="Add Operator" />}
        />
        <Split primary={<Primary />} secondary={<Secondary />} />
      </ThemeProvider>
    </Main>
  )
}

export default App
