import React from 'react'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'

export const ListItemUnformattedValue = ({ label, value }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>{value}</LoadableElement>
    </ListItem>
  )
}
