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
  useTheme,
  IconConnect,
  IconRemove,
} from '@aragon/ui'
import Button from '@aragon/ui/dist/Button'
import ChangeFeeSidePanel from './components/ChangeFeeSidePanel'
import ChangeWCSidePanel from './components/ChangeWCSidePanel'
import { ListItem } from './components/ListItem'
import StakeSidePanel from './components/StakeSidePanel'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const appName = (currentApp && currentApp.name) || 'app'
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

  const theme = useTheme()

  const resume = useCallback(() => {
    api.resume().toPromise()
  }, [api])

  const stop = useCallback(() => {
    api.stop().toPromise()
  }, [api])

  const data = useMemo(() => {
    const {
      isStopped,
      fee,
      // feeDistribution,
      withdrawalCredentials,
      bufferedEther,
      totalPooledEther,
      token,
      validatorRegistrationContract,
      oracle,
      // operators,
      // treasury,
      // insuranceFund,
      // beaconStat,
    } = appState

    return [
      {
        label: 'Status',
        content: isStopped ? (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong
              css={`
                color: ${theme.negative};
              `}
            >
              INACTIVE
            </strong>
            <Button
              label="RESUME"
              icon={
                <IconConnect
                  css={`
                    color: ${theme.positive};
                  `}
                />
              }
              display="icon"
              onClick={resume}
              style={{ marginLeft: 10 }}
            />
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong
              css={`
                color: ${theme.positive};
              `}
            >
              LIVE
            </strong>
            <Button
              label="PAUSE"
              icon={
                <IconRemove
                  css={`
                    color: ${theme.negative};
                  `}
                />
              }
              display="icon"
              onClick={stop}
              style={{ marginLeft: 10 }}
            />
          </span>
        ),
      },
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
        label: 'Total Pooled Ether',
        content: <strong>{totalPooledEther || 'No data'}</strong>,
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
  }, [appState, theme])

  const beaconStatData = useMemo(() => {
    const { beaconStat: stat } = appState
    return [
      {
        label: 'Deposits',
        content: <strong>{stat.depositedValidators}</strong>,
      },
      { label: 'Balance', content: <strong>{stat.beaconBalance}</strong> },
    ]
  }, [appState])

  const [stakeSidePanelOpen, setStakeSidePanelOpen] = useState(false)
  const openStakeSidePanel = useCallback(() => setStakeSidePanelOpen(true), [])
  const closeStakeSidePanel = useCallback(
    () => setStakeSidePanelOpen(false),
    []
  )
  const stake = useCallback(
    (address) => {
      return api
        .submit(address || '0x0000000000000000000000000000000000000000', {
          value: '0x1bc16d674ec800000', // 32ETH
        })
        .toPromise()
    },
    [api]
  )

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header
        primary={appName.toUpperCase()}
        secondary={
          <Button
            mode="strong"
            onClick={openStakeSidePanel}
            css={`
              background: ${theme.negative};
            `}
          >
            STAKE
          </Button>
        }
      />
      <Split
        primary={
          <Box heading="Details" padding={20}>
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
          <Box heading="Beacon stat">
            <ul>
              {beaconStatData.map(({ label, content }, index) => (
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
      <StakeSidePanel
        opened={stakeSidePanelOpen}
        onClose={closeStakeSidePanel}
        api={stake}
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
