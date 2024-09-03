import { useAppState } from '@aragon/api-react'
import { DataView, GU, Help, IdentityBadge } from '@aragon/ui'
import React from 'react'
import styled, { keyframes } from 'styled-components'

const ColumnName = styled.div`
  display: flex;
  justify-content: flex-end;
  & > :first-child {
    margin-right: ${GU}px;
  }
`

const blink = keyframes`
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
`

const Dot = styled.span`
  margin-right: ${GU}px;
  color: ${(props) =>
    props.active ? props.theme.positive : props.theme.negative};
  animation: ${blink} 0.5s infinite alternate;
`

export const NodeOperatorList = () => {
  let { nodeOperators } = useAppState()

  nodeOperators = nodeOperators || []

  return (
    <DataView
      fields={[
        '',
        'Node operators',
        'Reward address',
        <ColumnName key={Math.random()}>
          <p>SL / SV / SKu / SKt </p>{' '}
          <Help hint="SL">
            Staking limit / Stopped validators / Used signing keys / Total
            signing keys{' '}
          </Help>
        </ColumnName>,
      ]}
      entries={nodeOperators}
      renderEntry={(no) => [
        <Dot key={no.id} active={no.active}>
          •
        </Dot>,
        no.name,
        <IdentityBadge key={name} entity={no.rewardAddress} />,
        no.stakingLimit +
          '/' +
          no.stoppedValidators +
          '/' +
          no.usedSigningKeys +
          '/' +
          no.totalSigningKeys,
      ]}
    />
  )
}
