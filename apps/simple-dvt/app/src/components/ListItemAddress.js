import React from 'react'
import { IdentityBadge } from '@aragon/ui'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'

export const ListItemAddress = ({ label, value }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>
        <IdentityBadge entity={value} />
      </LoadableElement>
    </ListItem>
  )
}
