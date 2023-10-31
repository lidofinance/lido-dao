import React from 'react'
import { useAppState } from '@aragon/api-react'
import { BoxUnpadded, ListItemBoolean, ListItemUnformattedValue } from '../shared'

export const SandBoxSecondary = () => {
  const {
    sandbox,
  } = useAppState()

  return (
    <>
      <BoxUnpadded heading="Meta">
        <ListItemUnformattedValue
          label="Module type"
          value={sandbox?.stakingModuleType ? sandbox?.stakingModuleType.slice(0, 4) : 'N/A'}
        />
        <ListItemBoolean label="Initialized" value={sandbox?.hasInitialized} />
        <ListItemUnformattedValue
          label="Init block"
          value={sandbox?.initializationBlock}
        />
        <ListItemUnformattedValue label="Version" value={sandbox?.contractVersion} />
      </BoxUnpadded>
    </>
  )
}
