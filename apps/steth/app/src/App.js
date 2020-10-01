import React, { useEffect } from 'react'
import { useAragonApi } from '@aragon/api-react'
import { Box, GU, Header, Main, SyncIndicator, textStyle } from '@aragon/ui'
import styled from 'styled-components'
import Button from '@aragon/ui/dist/Button'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const { tokenName, isStopped, isSyncing } = appState
  const { appearance } = guiStyle
  const appName = (currentApp && currentApp.name) || 'app'
  const version = 'v0.0.1'

  const resume = () => {
    api.resume().toPromise()
  }

  const stop = () => {
    api.stop().toPromise()
  }

  const getName = async () => {
    const name = await api.name().toPromise()
    console.log('Name: ' + name)
  }

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      <Header primary={appName.toUpperCase()} secondary={version} />
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
        <div>{tokenName}</div>
        <div>Status: {isStopped ? 'INACTIVE' : 'ACTIVE'}</div>
        <Button onClick={resume}>resume</Button>
        <br />
        <Button onClick={stop}>stop</Button>
        <br />
        <Button onClick={getName}>print appName</Button>
      </Box>
    </Main>
  )
}
