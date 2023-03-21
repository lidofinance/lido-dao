import React from 'react'
import { formatEth } from '../../utils'
import { constants } from 'ethers'

export const Ether = ({
  ether,
  symbol = constants.EtherSymbol,
  symbolAfter = false,
}) => {
  try {
    ether = formatEth(ether)
  } catch (error) {
    console.warn(error)
    return <span>N/A</span>
  }

  return (
    <span>
      {!symbolAfter && symbol}
      {ether}
      {symbolAfter && ' ' + symbol}
    </span>
  )
}
