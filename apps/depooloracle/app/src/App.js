import React, { useCallback, useEffect, useState } from 'react'
import { useAragonApi } from '@aragon/api-react'
import {
  Box,
  Button,
  ContextMenu,
  DataView,
  GU,
  Header,
  IconRemove,
  IconTrash,
  IdentityBadge,
  Main,
  Split,
  SyncIndicator,
  textStyle,
  useTheme,
} from '@aragon/ui'
import styled from 'styled-components'
import AddMemberSidePanel from './components/AddMemberSidePanel'
import MenuItem from './components/MenuItem'
import InfoBox from './components/InfoBox'
import ChangeQuorumSidePanel from './components/ChangeQuorumSidePanel'
import IntervalInfo from './components/IntervalInfo'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const theme = useTheme()
  const {
    isSyncing,
    oracleMembers,
    quorum,
    latestData,
    reportIntervalDurationSeconds,
  } = appState
  const { appearance } = guiStyle
  const appName = (currentApp && currentApp.name) || 'app'

  // MEMBERS

  const [addMemberSidePanelOpen, setAddMemberSidePanelOpen] = useState(false)

  const openAddMemberSidePanel = useCallback(
    () => setAddMemberSidePanelOpen(true),
    []
  )

  const closeAddMemberSidePanel = useCallback(
    () => setAddMemberSidePanelOpen(false),
    []
  )

  const addOracleMember = useCallback(
    (address) => {
      return api.addOracleMember(address).toPromise()
    },
    [api]
  )

  const removeOracleMember = useCallback(
    (address) => {
      api.removeOracleMember(address).toPromise()
    },
    [api]
  )

  // QUORUM
  const [changeQuorumSidePanelOpen, setChangeQuorumSidePanelOpen] = useState(
    false
  )

  const openChangeQuorumSidePanel = useCallback(
    () => setChangeQuorumSidePanelOpen(true),
    []
  )

  const closeChangeQuorumSidePanel = useCallback(
    () => setChangeQuorumSidePanelOpen(false),
    []
  )

  const setQuorum = useCallback(
    (quorum) => {
      return api.setQuorum(quorum).toPromise()
    },
    [api]
  )

  // INTERVAL

  const getReportIntervalForTimestamp = useCallback(
    (timestamp) => {
      return api.call('getReportIntervalForTimestamp', timestamp).toPromise()
    },
    [api]
  )

  const [currentReportInterval, setCurrentReportInterval] = useState(0)
  const updateCurrentReportInterval = useCallback(() => {
    api
      .call('getCurrentReportInterval')
      .toPromise()
      .then(setCurrentReportInterval)
  }, [api])

  useEffect(() => {
    if (api) {
      updateCurrentReportInterval()
    }
  }, [api])

  console.log(latestData)

  return (
    <Main theme={appearance} assetsUrl="./aragon-ui">
      {isSyncing && <SyncIndicator />}
      <Header
        primary={appName.toUpperCase()}
        secondary={
          <Button
            mode="strong"
            label="Add Member"
            onClick={openAddMemberSidePanel}
          />
        }
      />
      <Split
        primary={
          <DataView
            fields={['Oracle Members']}
            entries={oracleMembers}
            renderEntry={(memberAddress) => [
              <IdentityBadge entity={memberAddress} />,
            ]}
            renderEntryActions={(memberAddress) => (
              <ContextMenu>
                <MenuItem
                  onClick={() => removeOracleMember(memberAddress)}
                  label="delete"
                  icon={<IconTrash />}
                  iconColor={theme.negative}
                />
              </ContextMenu>
            )}
          />
        }
        secondary={
          <React.Fragment>
            <InfoBox
              heading="Quorum"
              value={quorum}
              onClick={openChangeQuorumSidePanel}
              label="Change Quorum"
            />
            {latestData && (
              <React.Fragment>
                <InfoBox
                  heading="ETH2 Balance"
                  value={latestData.eth2balance}
                />
                <InfoBox
                  heading="Report Interval"
                  value={latestData.reportInterval}
                />
              </React.Fragment>
            )}
            <IntervalInfo
              duration={reportIntervalDurationSeconds}
              currentInterval={currentReportInterval}
              update={updateCurrentReportInterval}
              api={getReportIntervalForTimestamp}
            />
          </React.Fragment>
        }
      />
      <AddMemberSidePanel
        opened={addMemberSidePanelOpen}
        onClose={closeAddMemberSidePanel}
        api={addOracleMember}
      />
      <ChangeQuorumSidePanel
        opened={changeQuorumSidePanelOpen}
        onClose={closeChangeQuorumSidePanel}
        api={setQuorum}
      />
    </Main>
  )
}
