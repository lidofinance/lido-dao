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
import { ListItem } from './components/ListItem'
import ChangeFeeSidePanel from './components/ChangeFeeSidePanel'
import ChangeWCSidePanel from './components/ChangeWCSidePanel'
import DbeSidePanel from './components/DbeSidePanel'
import ChangeFeeDistrSidePanel from './components/ChangeFeeDistrSidePanel'
import WcBadge from './components/WcBadge'
import { formatEth } from './utils'

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
      return api.setFee(newFee).toPromise()
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

  const [changeFeeDistrPanelOpened, setChangeFeeDistrPanelOpened] = useState(
    false
  )
  const openChangeFeeDistrPanel = useCallback(() => {
    setChangeFeeDistrPanelOpened(true)
  }, [])
  const closeChangeFeeDistrPanel = useCallback(() => {
    setChangeFeeDistrPanelOpened(false)
  }, [])
  const apiSetFeeDistr = useCallback(
    (treasury, insurance, operators) => {
      return api.setFeeDistribution(treasury, insurance, operators).toPromise()
    },
    [api]
  )

  const data = useMemo(() => {
    const {
      isStopped,
      fee,
      feeDistribution,
      withdrawalCredentials,
      bufferedEther,
      totalPooledEther,
      nodeOperatorsRegistry,
      depositContract,
      oracle,
      executionLayerRewardsVault,
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
            <strong>{fee ? `${fee / 100}%` : 'No data'}</strong>
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
        label: 'Fee distribution',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <Button
              icon={<IconEdit />}
              label="Change fee"
              display="icon"
              onClick={openChangeFeeDistrPanel}
              style={{ marginLeft: 10 }}
            />
          </span>
        ),
      },
      {
        label: 'Treasury',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong>
              {feeDistribution.treasuryFeeBasisPoints
                ? `${feeDistribution.treasuryFeeBasisPoints / 100}%`
                : 'No data'}
            </strong>
          </span>
        ),
        subBullet: true,
      },
      {
        label: 'Insurance',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong>
              {feeDistribution.insuranceFeeBasisPoints
                ? `${feeDistribution.insuranceFeeBasisPoints / 100}%`
                : 'No data'}
            </strong>
          </span>
        ),
        subBullet: true,
      },
      {
        label: 'Operators',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            <strong>
              {feeDistribution.operatorsFeeBasisPoints
                ? `${feeDistribution.operatorsFeeBasisPoints / 100}%`
                : 'No data'}
            </strong>
          </span>
        ),
        subBullet: true,
      },
      {
        label: 'Withdrawal Credentials',
        content: (
          <span style={{ display: 'flex', alignItems: 'center' }}>
            {withdrawalCredentials ? (
              <WcBadge wc={withdrawalCredentials} />
            ) : (
              <strong>None</strong>
            )}
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
        content: <strong>{formatEth(bufferedEther) || 'No data'}</strong>,
      },
      {
        label: 'Total Pooled Ether',
        content: <strong>{formatEth(totalPooledEther) || 'No data'}</strong>,
      },
      {
        label: 'Deposit Contract',
        content: <IdentityBadge entity={depositContract} />,
      },
      {
        label: 'Node operators registry',
        content: <IdentityBadge entity={nodeOperatorsRegistry} />,
      },
      {
        label: 'Oracle',
        content: <IdentityBadge entity={oracle} />,
      },
      {
        label: 'Execution layer rewards Vault',
        content: <IdentityBadge entity={executionLayerRewardsVault} />,
      },
    ]
  }, [
    appState,
    openChangeFeeDistrPanel,
    resume,
    stop,
    theme.negative,
    theme.positive,
  ])

  const beaconStatData = useMemo(() => {
    const { beaconStat: stat } = appState
    return [
      {
        label: 'Deposits',
        content: <strong>{stat.depositedValidators}</strong>,
      },
      {
        label: 'Balance',
        content: <strong>{formatEth(stat.beaconBalance)}</strong>,
      },
    ]
  }, [appState])

  const [dbePanelOpen, setDbePanelOpen] = useState(false)
  const openDbePanel = useCallback(() => setDbePanelOpen(true), [])
  const closeDbePanel = useCallback(() => setDbePanelOpen(false), [])
  const apiDepositBufferedEther = useCallback(() => {
    return api.depositBufferedEther()
  }, [api])

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header
        primary={appName.toUpperCase()}
      />
      <Split
        primary={
          <Box heading="Details" padding={20}>
            <ul>
              {data.map(({ label, content, subBullet }, index) => (
                <ListItem key={label + index} subBullet={subBullet}>
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
      <DbeSidePanel
        opened={dbePanelOpen}
        onClose={closeDbePanel}
        api={apiDepositBufferedEther}
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
      <ChangeFeeDistrSidePanel
        opened={changeFeeDistrPanelOpened}
        onClose={closeChangeFeeDistrPanel}
        api={apiSetFeeDistr}
      />
    </Main>
  )
}
