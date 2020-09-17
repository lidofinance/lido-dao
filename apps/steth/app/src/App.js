import React from 'react'
import { useAragonApi } from '@aragon/api-react'
import {
  Box,
  GU,
  Header,
  Main,
  SyncIndicator,
  textStyle,
} from '@aragon/ui'
import styled from 'styled-components'

export default function App() {
  const { api, appState, path, requestPath, currentApp, guiStyle } = useAragonApi()
  const { isSyncing } = appState
  const { appearance } = guiStyle
  const appName = (currentApp && currentApp.name) || 'app'
  const version = 'v0.0.1'
  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header
        primary={appName.toUpperCase()}
        secondary={version}
      />
      <Box
        css={`
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          height: ${50 * GU}px;
          ${textStyle('title3')};
        `}
      >
        {appName} app will be here
      </Box>
    </Main>
  )
}
