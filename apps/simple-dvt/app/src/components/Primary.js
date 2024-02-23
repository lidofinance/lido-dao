import { useAppState } from '@aragon/api-react'
import React from 'react'
import { ListItemUnformattedValue } from './ListItemUnformattedValue'
import { NodeOperatorList } from './NodeOperatorList'
import { BoxUnpadded } from './styles'

export const Primary = () => {
  const {
    nonce,
    nodeOperatorsCount,
    activeNodeOperatorsCount,
    stakingModuleSummary,
    stuckPenaltyDelay,
  } = useAppState()

  return (
    <>
      <BoxUnpadded heading="Summary">
        <ListItemUnformattedValue label="Nonce" value={nonce} />
        <ListItemUnformattedValue
          label="Node operators"
          value={nodeOperatorsCount}
        />
        <ListItemUnformattedValue
          label="Active node operators"
          value={activeNodeOperatorsCount}
        />
        <ListItemUnformattedValue
          label="Exited validators"
          value={stakingModuleSummary?.totalExitedValidators}
        />
        <ListItemUnformattedValue
          label="Deposited validators"
          value={stakingModuleSummary?.totalDepositedValidators}
        />
        <ListItemUnformattedValue
          label="Depositable validators"
          value={stakingModuleSummary?.depositableValidatorsCount}
        />
        <ListItemUnformattedValue
          label="Stuck penalty delay"
          value={stuckPenaltyDelay}
        />
      </BoxUnpadded>
      <NodeOperatorList />
    </>
  )
}
