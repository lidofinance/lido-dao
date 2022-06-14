import { useAppState } from '@aragon/api-react'
import { IdentityBadge } from '@aragon/ui'
import React from 'react'
import { ListItem, LoadableElement } from '../shared'

export const DepositContract = () => {
  const { depositContract } = useAppState()

  return (
    <ListItem label="Deposit Contract">
      <LoadableElement value={depositContract}>
        <IdentityBadge entity={depositContract} />
      </LoadableElement>
    </ListItem>
  )
}
