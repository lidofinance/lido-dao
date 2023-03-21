import { useAppState, useAragonApi } from '@aragon/api-react'
import React from 'react'
import {
  BoxUnpadded,
  ListItemAddress,
  ListItemEther,
  ListItemUnformattedValue,
} from './shared'

export const StETH = () => {
  const { currentApp } = useAragonApi()
  const { symbol, decimals, totalSupply } = useAppState()

  return (
    <BoxUnpadded heading="Token">
      <ListItemUnformattedValue label="Symbol" value={symbol} />
      <ListItemUnformattedValue label="Decimals" value={decimals} />
      <ListItemEther
        label="Total supply"
        value={totalSupply}
        symbol={symbol}
        symbolAfter
      />
      <ListItemAddress label="Address" value={currentApp?.appAddress} />
    </BoxUnpadded>
  )
}
