import { useAragonApi } from '@aragon/api-react'
import { Header, Main, SyncIndicator, useTheme } from '@aragon/ui'
import React from 'react'
import { ThemeProvider } from 'styled-components'
import { Primary } from './components/Primary'
import { Secondary } from './components/Secondary'
import { Split } from './components/shared'


export default function App() {
  const { appState, currentApp, guiStyle } = useAragonApi()
  const appName = (currentApp && currentApp.name) || 'app'
  const { appearance } = guiStyle
  const { isSyncing } = appState
  const theme = useTheme()

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      <ThemeProvider theme={theme}>
        {isSyncing && <SyncIndicator />}
        <Header primary={appName} />
        <Split primary={<Primary />} secondary={<Secondary />} />
      </ThemeProvider>
    </Main>
  )
}
