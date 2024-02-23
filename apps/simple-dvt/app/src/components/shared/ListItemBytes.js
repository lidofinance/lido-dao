import React from 'react'
import { IdentityBadge } from '@aragon/ui'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'
import { BytesBadge } from './BytesBadge'

export const ListItemBytes = ({ label, value }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>
        <BytesBadge bytes={value} />
      </LoadableElement>
    </ListItem>
  )
}
