import { useAppState } from '@aragon/api-react'
import React from 'react'
import {
  BoxUnpadded,
  ListItemBoolean,
  ListItemUnformattedValue,
} from './shared'

export const Meta = () => {
  const { hasInitialized, initializationBlock, contractVersion } = useAppState()

  return (
    <BoxUnpadded heading="Meta">
      <ListItemBoolean label="Initialized" value={hasInitialized} />
      <ListItemUnformattedValue
        label="Init block"
        value={initializationBlock}
      />
      <ListItemUnformattedValue label="Lido version" value={contractVersion} />
    </BoxUnpadded>
  )
}
