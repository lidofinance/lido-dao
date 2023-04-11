import React from 'react'
import { BoxUnpadded } from './styles'
import { ListItemUnformattedValue } from './ListItemUnformattedValue'
import { useAppState } from '@aragon/api-react'
import { ListItemBoolean } from './ListItemBoolean'

export const Secondary = () => {
  const {
    stakingModuleType,
    hasInitialized,
    initializationBlock,
    contractVersion,
  } = useAppState()

  return (
    <>
      <BoxUnpadded heading="Meta">
        <ListItemUnformattedValue
          label="Module type"
          value={stakingModuleType ? stakingModuleType.slice(0, 4) : 'N/A'}
        />
        <ListItemBoolean label="Initialized" value={hasInitialized} />
        <ListItemUnformattedValue
          label="Init block"
          value={initializationBlock}
        />
        <ListItemUnformattedValue label="Version" value={contractVersion} />
      </BoxUnpadded>
    </>
  )
}
