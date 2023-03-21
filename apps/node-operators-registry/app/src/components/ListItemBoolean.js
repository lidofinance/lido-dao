import React from 'react'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'

export const ListItemBoolean = ({ label, value }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>{value ? 'Yes' : 'No'}</LoadableElement>
    </ListItem>
  )
}
