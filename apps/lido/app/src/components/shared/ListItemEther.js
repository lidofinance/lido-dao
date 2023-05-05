import React from 'react'
import { ListItem } from './ListItem'
import { Ether } from './Ether'
import { LoadableElement } from './LoadableElement'

export const ListItemEther = ({ label, value, symbol, symbolAfter }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>
        <Ether ether={value} symbol={symbol} symbolAfter={symbolAfter} />
      </LoadableElement>
    </ListItem>
  )
}
