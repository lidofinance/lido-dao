import { useAppState } from '@aragon/api-react'
import { constants } from 'ethers'
import React from 'react'
import { formatEth } from '../../utils'
import { ListItem, LoadableElement } from '../shared'

export const BufferedEther = () => {
  const { bufferedEther } = useAppState()

  return (
    <ListItem label="Buffered Ether">
      <LoadableElement value={bufferedEther}>
        {constants.EtherSymbol}
        {formatEth(bufferedEther)}
      </LoadableElement>
    </ListItem>
  )
}
