import React, { useCallback, useState } from 'react'
import { useAragonApi } from '@aragon/api-react'
import {
  Button,
  ContextMenu,
  DataView,
  GU,
  Header,
  IconCircleMinus,
  IconTrash,
  IdentityBadge,
  Main,
  Split,
  SyncIndicator,
  textStyle,
  useTheme,
} from '@aragon/ui'
import AddMemberSidePanel from './components/AddMemberSidePanel'
import MenuItem from './components/MenuItem'
import InfoBox from './components/InfoBox'
import ChangeQuorumSidePanel from './components/ChangeQuorumSidePanel'
import ChangeBeaconReportReceiverSidePanel from './components/ChangeBeaconReportReceiverSidePanel'
import IconEdit from '@aragon/ui/dist/IconEdit'
import ChangeIncreaseSidePanel from './components/ChangeIncreaseSidePanel'
import ChangeDecreaseSidePanel from './components/ChangeDecreaseSidePanel'
import { constants, ethers } from 'ethers'
import IconCircleCheck from '@aragon/ui/dist/IconCircleCheck'

export default function App() {
  const { api, appState, currentApp, guiStyle } = useAragonApi()
  const theme = useTheme()
  const {
    isSyncing,
    oracleMembers,
    quorum,
    currentFrame,
    expectedEpochId,
    currentOraclesReportStatus,
    allowedBeaconBalanceAnnualRelativeIncrease,
    allowedBeaconBalanceRelativeDecrease,
    beaconReportReceiver,
    currentReportVariants,
    lastCompletedReportDelta,
    version,
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

  // INCREASE
  const [increaseSidePanelOpen, setIncreaseSidePanelOpen] = useState(false)

  const openIncreaseSidePanel = useCallback(
    () => setIncreaseSidePanelOpen(true),
    []
  )

  const closeIncreaseSidePanel = useCallback(
    () => setIncreaseSidePanelOpen(false),
    []
  )

  const changeIncrease = useCallback(
    (value) => {
      api.setAllowedBeaconBalanceAnnualRelativeIncrease(value).toPromise()
    },
    [api]
  )

  // DECREASE
  const [decreaseSidePanelOpen, setDecreaseSidePanelOpen] = useState(false)

  const openDecreaseSidePanel = useCallback(
    () => setDecreaseSidePanelOpen(true),
    []
  )

  const closeDecreaseSidePanel = useCallback(
    () => setDecreaseSidePanelOpen(false),
    []
  )

  const changeDecrease = useCallback(
    (value) => {
      api.setAllowedBeaconBalanceRelativeDecrease(value).toPromise()
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

  // BEACON REPORT RECEIVER
  const [
    reportReceiverSidePanelOpen,
    setReportReceiverSidePanelOpen,
  ] = useState(false)

  const openReportReceiverSidePanel = useCallback(
    () => setReportReceiverSidePanelOpen(true),
    []
  )
  const closeReportReceiverSidePanel = useCallback(
    () => setReportReceiverSidePanelOpen(false),
    []
  )

  const setBeaconReceiver = useCallback(
    (address) => {
      return api.setBeaconReportReceiver(address).toPromise()
    },
    [api]
  )

  // RENDER ELEMENTS

  const currentFrameEl = renderCurrentFrame(currentFrame)
  const lastCompletedReportDeltaEl = renderLastCompletedReportDelta(
    lastCompletedReportDelta
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
          <>
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
            <p
              css={`
                margin: ${3 * GU}px 0 ${GU}px;
                ${textStyle('body1')}
              `}
            >
              Current Report Variants
            </p>
            <DataView
              fields={['#', 'Beacon balance', 'Beacon validators', 'Count']}
              entries={currentReportVariants}
              renderEntry={({ beaconBalance, beaconValidators, count }, i) => [
                <strong>{i}</strong>,
                <strong>{beaconBalance}</strong>,
                <strong>{beaconValidators}</strong>,
                <strong>{count}</strong>,
              ]}
            />
            <p
              css={`
                margin: ${3 * GU}px 0 ${GU}px;
                ${textStyle('body1')}
              `}
            >
              Settings
            </p>
            <DataView
              fields={['', '']}
              entries={[
                expectedEpochId,
                currentOraclesReportStatus,
                allowedBeaconBalanceAnnualRelativeIncrease,
                allowedBeaconBalanceRelativeDecrease,
                beaconReportReceiver,
              ]}
              renderEntry={(value, i) =>
                renderInfo(
                  value,
                  i,
                  openIncreaseSidePanel,
                  openDecreaseSidePanel,
                  openReportReceiverSidePanel,
                  oracleMembers.length,
                  theme
                )
              }
            />
          </>
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
            {lastCompletedReportDeltaEl && (
              <InfoBox
                heading="Last completed report delta"
                value={lastCompletedReportDeltaEl}
              />
            )}
            {version && (
              <p
                css={`
                  ${textStyle('body2')};
                  color: ${theme.contentSecondary};
                  margin-top: ${2 * GU}px;
                  text-align: right;
                `}
              >
                Lido Oracle v{version}
              </p>
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
      <ChangeIncreaseSidePanel
        opened={increaseSidePanelOpen}
        onClose={closeIncreaseSidePanel}
        api={changeIncrease}
      />
      <ChangeDecreaseSidePanel
        opened={decreaseSidePanelOpen}
        onClose={closeDecreaseSidePanel}
        api={changeDecrease}
      />
      <ChangeBeaconReportReceiverSidePanel
        opened={reportReceiverSidePanelOpen}
        onClose={closeReportReceiverSidePanel}
        api={setBeaconReceiver}
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
      <LabelValue label="Epoch:" value={frame.frameEpochId} />
      <LabelValue label="Start:" value={formatUnixTime(frame.frameStartTime)} />
      <LabelValue label="End:" value={formatUnixTime(frame.frameEndTime)} />
    </>
  )
}

function renderInfo(
  value,
  i,
  openIncreaseSidePanel,
  openDecreaseSidePanel,
  openReportReceiverSidePanel,
  oraclesCount,
  theme
) {
  switch (i) {
    case 0:
      return ['Expected epoch id', value]
    case 1:
      return [
        'Current Oracles Report Status',
        <div>
          {oraclesCount <= 10
            ? convertOraclesReportStatus(value, oraclesCount).map((num) =>
                num ? (
                  <IconCircleCheck
                    css={`
                      color: ${theme.positive};
                    `}
                  />
                ) : (
                  <IconCircleMinus
                    css={`
                      color: ${theme.negative};
                    `}
                  />
                )
              )
            : value}
        </div>,
      ]
    case 2:
      return [
        'Allowed Beacon Balance Annual Increase',
        <div
          css={`
            display: flex;
            align-items: center;
          `}
        >
          <span>{value}</span>
          <Button
            icon={<IconEdit />}
            label="Change increase"
            display="icon"
            onClick={openIncreaseSidePanel}
            style={{ marginLeft: 10 }}
          />
        </div>,
      ]
    case 3:
      return [
        'Allowed Beacon Balance Relative Decrease',
        <div
          css={`
            display: flex;
            align-items: center;
          `}
        >
          <span>{value}</span>
          <Button
            icon={<IconEdit />}
            label="Change decrease"
            display="icon"
            onClick={openDecreaseSidePanel}
            style={{ marginLeft: 10 }}
          />
        </div>,
      ]
    case 4:
      return [
        'Beacon Report Receiver',
        <div
          css={`
            display: flex;
            align-items: center;
          `}
        >
          <IdentityBadge entity={value} />
          <Button
            icon={<IconEdit />}
            label="Change receiver"
            display="icon"
            onClick={openReportReceiverSidePanel}
            style={{ marginLeft: 10 }}
          />
        </div>,
      ]
    default:
      return null
  }
}

function renderLastCompletedReportDelta(lastCompletedReportDelta) {
  if (!lastCompletedReportDelta) return null

  return (
    <>
      <LabelValue
        label="Post-total:"
        value={`${constants.EtherSymbol}${ethers.utils.formatEther(
          lastCompletedReportDelta.postTotalPooledEther
        )}`}
      />
      <LabelValue
        label="Pre-total:"
        value={`${constants.EtherSymbol}${ethers.utils.formatEther(
          lastCompletedReportDelta.preTotalPooledEther
        )}`}
      />
      <LabelValue
        label="Time elapsed:"
        value={`${lastCompletedReportDelta.timeElapsed}s`}
      />
    </>
  )
}

function LabelValue({ label, value }) {
  return (
    <div
      css={`
        display: flex;
        align-items: center;
        justify-content: space-between;
        overflow: hidden;
      `}
    >
      <p
        css={`
          ${textStyle('body3')}
          margin-right: ${2 * GU}px;
          white-space: nowrap;
        `}
      >
        {label}
      </p>
      <p
        css={`
          ${textStyle('body3')}
          white-space: nowrap;
          text-overflow: ellipsis;
          overflow: hidden;
        `}
      >
        {value}
      </p>
    </div>
  )
}

function formatUnixTime(unixTime) {
  return new Date(1000 * unixTime).toISOString().replace(/[.]\d+Z$/, 'Z')
}

function convertOraclesReportStatus(uint256, oraclesCount) {
  const reported = []
  let cursor = 1

  for (let i = 0; i < oraclesCount; i++) {
    reported.push(uint256 & cursor)
    cursor *= 2
  }

  return reported
}
