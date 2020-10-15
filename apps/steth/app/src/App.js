import React from 'react'
import { useAragonApi } from '@aragon/api-react'
import {
  Box,
  GU,
  Header,
  Main,
  SyncIndicator,
  Button,
  useTheme,
} from '@aragon/ui'
import ListItem from './components/ListItem'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const { tokenName, tokenSymbol, totalSupply, isStopped, isSyncing } = appState
  const { appearance } = guiStyle
  const appName = (currentApp && currentApp.name) || 'app'
  const theme = useTheme()

  const resume = () => {
    api.resume().toPromise()
  }

  const stop = () => {
    api.stop().toPromise()
  }

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header
        primary={appName.toUpperCase()}
        secondary={
          <Button
            mode="strong"
            onClick={isStopped ? resume : stop}
            label={isStopped ? 'RESUME' : 'PAUSE'}
            display="label"
          />
        }
      />
      <Box
        heading={tokenName}
        padding={20}
        css={`
          h1 {
            font-size: 24px;
            padding: 8px;
            height: unset;
            text-transform: initial;
            font-weight: 400;
            justify-content: center;
          }
        `}
      >
        <ul>
          {[
            ['Token', <strong>{tokenName}</strong>],
            ['Symbol', <strong>{tokenSymbol}</strong>],
            ['Total supply', <strong>{totalSupply}</strong>],
            [
              'Status',
              isStopped ? (
                <strong
                  css={`
                    color: ${theme.negative};
                  `}
                >
                  INACTIVE
                </strong>
              ) : (
                <strong
                  css={`
                    color: ${theme.positive};
                  `}
                >
                  LIVE
                </strong>
              ),
            ],
          ].map(([label, content], index) => (
            <ListItem key={index}>
              <span>{label}</span>
              <span>:</span>
              {content}
            </ListItem>
          ))}
        </ul>
      </Box>
    </Main>
  )
}
