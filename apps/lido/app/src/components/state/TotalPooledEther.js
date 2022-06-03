import { useAppState } from '@aragon/api-react'
import { constants } from 'ethers'
import React from 'react'
import { formatEth } from '../../utils'
import { ListItem, LoadableElement } from '../shared'

export const TotalPooledEther = () => {
  const { totalPooledEther } = useAppState()

  return (
    <ListItem label="Total Pooled Ether">
      <LoadableElement value={totalPooledEther}>
        {constants.EtherSymbol}
        {formatEth(totalPooledEther)}
      </LoadableElement>
    </ListItem>
  )
}
