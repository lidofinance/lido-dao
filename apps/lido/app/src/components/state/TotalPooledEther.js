import { useAppState } from '@aragon/api-react'
import React from 'react'
import { ListItem } from '../shared'
import { Ether } from '../shared/Ether'

export const TotalPooledEther = () => {
  const { totalPooledEther } = useAppState()

  return (
    <ListItem label="Total Pooled Ether">
      <Ether ether={totalPooledEther} />
    </ListItem>
  )
}
