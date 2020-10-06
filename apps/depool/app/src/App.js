import React, { useCallback, useMemo, useState } from 'react'
import { useAragonApi } from '@aragon/api-react'
import {
  Box,
  Header,
  IconEdit,
  Main,
  Split,
  SyncIndicator,
  IdentityBadge,
} from '@aragon/ui'
import Button from '@aragon/ui/dist/Button'
import ChangeFeeSidePanel from './components/ChangeFeeSidePanel'
import ChangeWCSidePanel from './components/ChangeWCSidePanel'
import { ListItem } from './components/ListItem'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const appName = (currentApp && currentApp.name) || 'app'
  const version = 'v0.0.1'
  const { appearance } = guiStyle

  const { isSyncing } = appState

  const [changeFeePanelOpened, setChangeFeePanelOpened] = useState(false)
  const openChangeFeePanel = () => setChangeFeePanelOpened(true)
  const closeChangeFeePanel = () => setChangeFeePanelOpened(false)
  const apiSetFee = useCallback(
    (newFee) => {
      return api.setFee(newFee)
    },
    [api]
  )

  const [changeWCPanelOpened, setChangeWCPanelOpened] = useState(false)
  const openChangeWCPanel = () => setChangeWCPanelOpened(true)
  const closeChangeWCPanel = () => setChangeWCPanelOpened(false)
  const apiSetWC = useCallback(
    (newWC) => {
      return api.setWithdrawalCredentials(newWC)
    },
    [api]
  )

  const data = useMemo(() => {
    const {
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

    return [
      {
        label: 'Fee',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong>{fee || 'No data'}</strong>
            <Button
              icon={<IconEdit />}
              label="Change fee"
              display="icon"
              onClick={openChangeFeePanel}
              style={{ marginLeft: 10 }}
            />
          </span>
        ),
      },
      {
        label: 'Withdrawal Credentials',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong>{withdrawalCredentials || 'Unset'}</strong>
            <Button
              icon={<IconEdit />}
              label="Change withdrawal credentials"
              display="icon"
              onClick={openChangeWCPanel}
              style={{ marginLeft: 10 }}
            />
          </span>
        ),
      },
      {
        label: 'Buffered Ether',
        content: <strong>{bufferedEther || 'No data'}</strong>,
      },
      {
        label: 'Total Controlled Ether',
        content: <strong>{totalControlledEther || 'No data'}</strong>,
      },
      {
        label: 'Validator Registration Contract',
        content: <IdentityBadge entity={validatorRegistrationContract} />,
      },
      {
        label: 'Token',
        content: <IdentityBadge entity={token} />,
      },
      {
        label: 'Oracle',
        content: <IdentityBadge entity={oracle} />,
      },
    ]
  }, [appState])

  const ether2StatData = useMemo(() => {
    const { ether2Stat } = appState

    return Object.entries(ether2Stat).map(([key, value]) => ({
      label: key,
      content: <strong>{value}</strong>,
    }))
  }, [appState])

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header
        primary={appName.toUpperCase()}
        secondary={version}
      />
      <Split
        primary={
          <Box heading={'Details'} padding={20}>
            <ul>
              {data.map(({ label, content }, index) => (
                <ListItem key={label + index}>
                  <span>{label}</span>
                  <span>:</span>
                  {content}
                </ListItem>
              ))}
            </ul>
          </Box>
        }
        secondary={
          <Box heading="ether2Stat">
            <ul>
              {ether2StatData.map(({ label, content }, index) => (
                <ListItem key={label + index}>
                  <span>{label}</span>
                  <span>:</span>
                  {content}
                </ListItem>
              ))}
            </ul>
          </Box>
        }
      />
      <ChangeFeeSidePanel
        opened={changeFeePanelOpened}
        onClose={closeChangeFeePanel}
        apiSetFee={apiSetFee}
      />
      <ChangeWCSidePanel
        opened={changeWCPanelOpened}
        onClose={closeChangeWCPanel}
        apiSetWC={apiSetWC}
      />
    </Main>
  )
}
