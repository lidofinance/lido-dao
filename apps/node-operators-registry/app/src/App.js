import React, { useCallback, useMemo, useState } from 'react'
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
import ChangeLimitPanel from './components/ChangeLimitPanel'
import IconGroup from '@aragon/ui/dist/IconGroup'

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
    (name, address) => api.addNodeOperator(name, address).toPromise(),
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
  const currentUserOperatorId = useMemo(() => {
    const currentUserAmongOperators = nodeOperators.find(
      ({ rewardAddress }) => rewardAddress === connectedAccount
    )
    if (!currentUserAmongOperators) return -1
    return currentUserAmongOperators.id
  }, [connectedAccount, nodeOperators])

  // CHANGING STAKING LIMIT
  const [changeLimitOperatorId, setChangeLimitOperatorId] = useState(null)
  const openChangeLimitPanel = useCallback(
    (id) => setChangeLimitOperatorId(id),
    []
  )
  const closeChangeLimitPanel = useCallback(
    () => setChangeLimitOperatorId(null),
    []
  )
  const changeLimitApi = useCallback(
    (limit) =>
      api.setNodeOperatorStakingLimit(changeLimitOperatorId, limit).toPromise(),
    [api, changeLimitOperatorId]
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
              '#',
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
              id,
            }) => [
              // eslint-disable-next-line react/jsx-key
              <strong>{id} </strong>,
              // eslint-disable-next-line react/jsx-key
              <strong>
                {name} {currentUserOperatorId === id && '(you)'}
              </strong>,
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
            renderEntryActions={({ name, active, id }) => (
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
                  onClick={() => openChangeLimitPanel(id)}
                  icon={<IconGroup />}
                  label="change staking limit"
                />
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
        title="Add signing keys as Manager"
        opened={addSigningKeysToOperatorId !== null}
        onClose={closeAddSKSidePanel}
        api={addSKManagerApi}
      />
      <ChangeLimitPanel
        title="Change staking limit"
        opened={changeLimitOperatorId !== null}
        onClose={closeChangeLimitPanel}
        api={changeLimitApi}
      />
    </Main>
  )
}

export default App
