import React from 'react'
import { LoadingRing } from '@aragon/ui'
import { formatEth } from '../../utils'
import { constants } from 'ethers'

export const Ether = ({ ether }) => {
  if (typeof ether === 'undefined') {
    return <LoadingRing />
  }

  try {
    ether = formatEth(ether)
  } catch (error) {
    console.warn(error)
    return <span>N/A</span>
  }

  return (
    <span>
      {constants.EtherSymbol}
      {ether}
    </span>
  )
}
