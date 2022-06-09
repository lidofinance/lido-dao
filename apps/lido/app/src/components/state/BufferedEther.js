import { useAppState } from '@aragon/api-react'
import React from 'react'
import { ListItem } from '../shared'
import { Ether } from '../shared/Ether'

export const BufferedEther = () => {
  const { bufferedEther } = useAppState()

  return (
    <ListItem label="Buffered Ether">
      <Ether ether={bufferedEther} />
    </ListItem>
  )
}
