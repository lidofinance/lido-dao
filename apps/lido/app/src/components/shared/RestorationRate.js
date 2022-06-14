import React from 'react'
import { LoadingRing } from '@aragon/ui'
import { constants } from 'ethers'
import { formatEth } from '../../utils'

export const RestorationRate = ({ maxLimit, blocks }) => {
  if (typeof maxLimit === 'undefined' || typeof blocks === 'undefined') {
    return <LoadingRing />
  }

  maxLimit = Number(maxLimit)
  blocks = Number(blocks)
  const rate = maxLimit / blocks

  if (Number.isNaN(maxLimit) || Number.isNaN(blocks) || Number.isNaN(rate)) {
    return <span>N/A</span>
  }

  return (
    <span>
      {constants.EtherSymbol}
      {formatEth(String(rate))} per block
    </span>
  )
}
