import React from 'react'
import { useAppState } from '@aragon/api-react'
import { BoxUnpadded, ListItemBoolean, ListItemUnformattedValue } from '../shared'

export const SimpleDVTSecondary = () => {
  const {
    simpleDVT,
  } = useAppState()

  return (
    <>
      <BoxUnpadded heading="Meta">
        <ListItemUnformattedValue
          label="Module type"
          value={simpleDVT?.stakingModuleType ? simpleDVT?.stakingModuleType.slice(0, 4) : 'N/A'}
        />
        <ListItemBoolean label="Initialized" value={simpleDVT?.hasInitialized} />
        <ListItemUnformattedValue
          label="Init block"
          value={simpleDVT?.initializationBlock}
        />
        <ListItemUnformattedValue label="Version" value={simpleDVT?.contractVersion} />
      </BoxUnpadded>
    </>
  )
}
