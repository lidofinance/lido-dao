import { IdentityBadge } from '@aragon/ui'
import React from 'react'
import { ListItem, LoadableElement } from '.'

export const ListItemAddress = ({ label, value }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>
        <IdentityBadge entity={value} />
      </LoadableElement>
    </ListItem>
  )
}
