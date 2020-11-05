import React, { useCallback, useState } from 'react'
import { useAragonApi, useGuiStyle } from '@aragon/api-react'
import {
  Button,
  ContextMenu,
  DataView,
  Header,
  IconCheck,
  IconClose,
  IconWrite,
  IdentityBadge,
  Main,
  Split,
  SyncIndicator,
  Toast,
  useTheme,
} from '@aragon/ui'
import AddNodeOperatorSidePanel from './components/AddNodeOperatorSidePanel'
import AddSigningKeysSidePanel from './components/AddSigningKeysSidePanel'
import MenuItem from './components/MenuItem'
import IconQuestion from '@aragon/ui/dist/IconQuestion'
import InfoBox from './components/InfoBox'
import { getEndingBasedOnNumber } from './utils/helpers'

function App() {
  const { api, appState, connectedAccount } = useAragonApi()
  const { appearance } = useGuiStyle()
  const {
    nodeOperatorsCount,
    activeNodeOperatorsCount,
    nodeOperators,
    isSyncing,
  } = appState

  const theme = useTheme()

  // ADD NODE OPERATOR
  const [
    AddNodeOperatorSidePanelOpen,
    setAddNodeOperatorSidePanelOpen,
  ] = useState(false)
  const openAddNodeOperatorSidePanel = useCallback(
    () => setAddNodeOperatorSidePanelOpen(true),
    []
  )
  const closeAddNodeOperatorSidePanel = useCallback(
    () => setAddNodeOperatorSidePanelOpen(false),
    []
  )
  const addNodeOperatorApi = useCallback(
    (name, address, limit) =>
      api.addNodeOperator(name, address, limit).toPromise(),
    [api]
  )

  // ENABLE / DISABLE
  const enableOperator = useCallback(
    (id) => {
      api.setNodeOperatorActive(id, true).toPromise()
    },
    [api]
  )

  const disableOperator = useCallback(
    (id) => {
      api.setNodeOperatorActive(id, false).toPromise()
    },
    [api]
  )

  // ADD SIGNING KEYS FOR MANAGER
  const [addSigningKeysToOperatorId, setAddSigningKeysToOperatorId] = useState(
    null
  )
  const openAddSKSidePanel = useCallback(
    (id) => setAddSigningKeysToOperatorId(id),
    []
  )
  const closeAddSKSidePanel = useCallback(
    () => setAddSigningKeysToOperatorId(null),
    []
  )
  const addSKManagerApi = useCallback(
    (quantity, pubkeys, signatures) =>
      api
        .addSigningKeys(
          addSigningKeysToOperatorId,
          quantity,
          pubkeys,
          signatures
        )
        .toPromise(),
    [api, addSigningKeysToOperatorId]
  )

  // ADD SIGNING KEYS FOR NodeOperator
  const [addMySKSidePanelOpen, setAddMySkSidePanelOpen] = useState(false)
  const openAddMySKSidePanelOpen = useCallback(
    () => setAddMySkSidePanelOpen(true),
    []
  )
  const closeAddMySKSidePanelOpen = useCallback(
    () => setAddMySkSidePanelOpen(false),
    []
  )
  const addSKApi = useCallback(
    (quantity, pubkeys, signatures) =>
      api
        .addSigningKeysNodeOperator(
          addSigningKeysToOperatorId,
          quantity,
          pubkeys,
          signatures
        )
        .toPromise(),
    [api, addSigningKeysToOperatorId]
  )

  // GET SIGNING KEYS
  const getSigningKeys = useCallback(
    (id) => {
      return api.call('getTotalSigningKeyCount', id).toPromise()
    },
    [api]
  )

  const getUnusedSigningKeyCount = useCallback(
    (id) => {
      return api.call('getUnusedSigningKeyCount', id).toPromise()
    },
    [api]
  )

  return (
    <Main theme={appearance}>
      <SyncIndicator visible={isSyncing} shift={50} />
      <Header
        primary="Node Operators Registry"
        secondary={
          <Button
            mode="strong"
            label="Add Operator"
            onClick={openAddNodeOperatorSidePanel}
          />
        }
      />
      <Split
        primary={
          <DataView
            fields={[
              'Node Operator',
              'Address',
              'Staking Limit',
              'Total / Used / Stopped',
              'Status',
            ]}
            entries={nodeOperators}
            renderEntry={({
              name,
              rewardAddress,
              stakingLimit,
              stoppedValidators,
              totalSigningKeys,
              usedSigningKeys,
              active,
            }) => [
              // eslint-disable-next-line react/jsx-key
              <strong>{name}</strong>,
              // eslint-disable-next-line react/jsx-key
              <IdentityBadge entity={rewardAddress} />,
              // eslint-disable-next-line react/jsx-key
              <strong>{stakingLimit}</strong>,
              // eslint-disable-next-line react/jsx-key
              <strong>
                {totalSigningKeys} / {usedSigningKeys} / {stoppedValidators}
              </strong>,
              active ? (
                <strong
                  css={`
                    color: ${theme.positive};
                  `}
                >
                  ACTIVE
                </strong>
              ) : (
                <strong
                  css={`
                    color: ${theme.negative};
                  `}
                >
                  INACTIVE
                </strong>
              ),
            ]}
            renderEntryActions={({ name, active, id, rewardAddress }) => (
              <ContextMenu zIndex={1}>
                {active ? (
                  <MenuItem
                    onClick={() => disableOperator(id)}
                    icon={<IconClose />}
                    label="disable"
                  />
                ) : (
                  <MenuItem
                    onClick={() => enableOperator(id)}
                    icon={<IconCheck />}
                    label="enable"
                  />
                )}
                <MenuItem
                  onClick={() => openAddSKSidePanel(id)}
                  icon={<IconWrite />}
                  label="add signing keys (Manager)"
                />
                {connectedAccount === rewardAddress && (
                  <MenuItem
                    onClick={openAddMySKSidePanelOpen}
                    icon={<IconWrite />}
                    label="add signing keys"
                  />
                )}
                <Toast>
                  {(toast) => (
                    <MenuItem
                      onClick={() => {
                        getSigningKeys(id).then((keyCount) => {
                          toast(
                            `${name} has ${keyCount} signing ${getEndingBasedOnNumber(
                              keyCount,
                              'key'
                            )}.`
                          )
                        })
                      }}
                      icon={<IconQuestion />}
                      label="number of signing keys"
                    />
                  )}
                </Toast>
                <Toast>
                  {(toast) => (
                    <MenuItem
                      onClick={() => {
                        getUnusedSigningKeyCount(id).then((keyCount) => {
                          toast(
                            `${name} has ${keyCount} unused signing ${getEndingBasedOnNumber(
                              keyCount,
                              'key'
                            )}.`
                          )
                        })
                      }}
                      icon={<IconQuestion />}
                      label="number of unused keys"
                    />
                  )}
                </Toast>
              </ContextMenu>
            )}
          />
        }
        secondary={
          <>
            <InfoBox heading="Number of operators" value={nodeOperatorsCount} />
            <InfoBox
              heading="Number of Active operators"
              value={activeNodeOperatorsCount}
            />
          </>
        }
      />
      <AddNodeOperatorSidePanel
        opened={AddNodeOperatorSidePanelOpen}
        onClose={closeAddNodeOperatorSidePanel}
        addNodeOperatorApi={addNodeOperatorApi}
      />
      <AddSigningKeysSidePanel
        opened={addSigningKeysToOperatorId !== null}
        onClose={closeAddSKSidePanel}
        api={addSKManagerApi}
      />
      <AddSigningKeysSidePanel
        opened={addMySKSidePanelOpen}
        onClose={closeAddMySKSidePanelOpen}
        api={addSKApi}
      />
    </Main>
  )
}

export default App
