import { useAppState } from '@aragon/api-react'
import { IdentityBadge } from '@aragon/ui'
import React from 'react'
import { ListItem, LoadableElement } from '../shared'

export const Oracle = () => {
  const { oracle } = useAppState()

  return (
    <ListItem label="Oracle">
      <LoadableElement value={oracle}>
        <IdentityBadge entity={oracle} />
      </LoadableElement>
    </ListItem>
  )
}
