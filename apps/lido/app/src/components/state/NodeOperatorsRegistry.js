import { useAppState } from '@aragon/api-react'
import { IdentityBadge } from '@aragon/ui'
import React from 'react'
import { ListItem, LoadableElement } from '../shared'

export const NodeOperatorsRegistry = () => {
  const { nodeOperatorsRegistry } = useAppState()

  return (
    <ListItem label="Node Operators Registry">
      <LoadableElement value={nodeOperatorsRegistry}>
        <IdentityBadge entity={nodeOperatorsRegistry} />
      </LoadableElement>
    </ListItem>
  )
}
