import React from 'react'
import { BasisPoints } from './BasisPoints'
import { ListItem } from './ListItem'
import { LoadableElement } from './LoadableElement'

export const ListItemBasisPoints = ({ label, value, ...rest }) => {
  return (
    <ListItem label={label} {...rest}>
      <LoadableElement value={value}>
        <BasisPoints basisPoints={value} />
      </LoadableElement>
    </ListItem>
  )
}
