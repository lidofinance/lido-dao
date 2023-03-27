import React from 'react'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'

export const ListItemBoolean = ({ label, value, renderElements = ["Yes", "No"] }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>{value ? renderElements[0] : renderElements[1]}</LoadableElement>
    </ListItem>
  )
}
