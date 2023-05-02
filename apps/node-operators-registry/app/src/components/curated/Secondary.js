import React from 'react'
import { useAppState } from '@aragon/api-react'
import { BoxUnpadded, ListItemBoolean, ListItemUnformattedValue } from '../shared'

export const CuratedSecondary = () => {
  const {
    curated,
  } = useAppState()

  return (
    <>
      <BoxUnpadded heading="Meta">
        <ListItemUnformattedValue
          label="Module type"
          value={curated?.stakingModuleType ? curated?.stakingModuleType.slice(0, 4) : 'N/A'}
        />
        <ListItemBoolean label="Initialized" value={curated?.hasInitialized} />
        <ListItemUnformattedValue
          label="Init block"
          value={curated?.initializationBlock}
        />
        <ListItemUnformattedValue label="Version" value={curated?.contractVersion} />
      </BoxUnpadded>
    </>
  )
}
