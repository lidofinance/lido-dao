import React, { useCallback, useEffect, useState } from 'react'
import { useAragonApi } from '@aragon/api-react'
import {
  Button,
  ContextMenu,
  DataView,
  Header,
  IconTrash,
  IdentityBadge,
  Main,
  Split,
  SyncIndicator,
  useTheme,
} from '@aragon/ui'
import AddMemberSidePanel from './components/AddMemberSidePanel'
import MenuItem from './components/MenuItem'
import InfoBox from './components/InfoBox'
import ChangeQuorumSidePanel from './components/ChangeQuorumSidePanel'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const theme = useTheme()
  const {
    isSyncing,
    oracleMembers,
    quorum,
    currentFrame,
    currentReportableEpochs,
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

  const currentFrameEl = renderCurrentFrame(currentFrame)
  const currentReportableEpochsEl = renderCurrentReportableEpochs(
    currentReportableEpochs
  )

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
              // eslint-disable-next-line react/jsx-key
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
          <>
            <InfoBox
              heading="Quorum"
              value={quorum}
              onClick={openChangeQuorumSidePanel}
              label="Change Quorum"
            />
            {currentFrameEl && (
              <InfoBox
                heading="Frame"
                value={currentFrameEl}
                largeText={false}
                label="Update"
                onClick={() => api.emitTrigger('UI:UpdateFrame')}
              />
            )}
            {currentReportableEpochsEl && (
              <InfoBox
                heading="Reportable epochs"
                value={currentReportableEpochsEl}
                largeText={false}
                label="Update"
                onClick={() => api.emitTrigger('UI:UpdateReportableEpochs')}
              />
            )}
          </>
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

function renderCurrentFrame(frame) {
  if (!frame) {
    return null
  }
  return (
    <>
      Epoch: {frame.frameEpochId}
      <br />
      Start: {formatUnixTime(frame.frameStartTime)}
      <br />
      End: {formatUnixTime(frame.frameEndTime)}
    </>
  )
}

function renderCurrentReportableEpochs(epochs) {
  if (!epochs) {
    return null
  }
  return (
    <>
      First: {epochs.firstReportableEpochId}
      <br />
      Last: {epochs.lastReportableEpochId}
    </>
  )
}

function formatUnixTime(unixTime) {
  return new Date(1000 * unixTime).toISOString().replace(/[.]\d+Z$/, 'Z')
}
