import React from 'react'
import { LoadingRing } from '@aragon/ui'

export const BasisPoints = ({ basisPoints }) => {
  if (typeof basisPoints === 'undefined' || Number.isNaN(basisPoints)) {
    return <LoadingRing />
  }

  basisPoints = Number(basisPoints)
  if (Number.isNaN(basisPoints)) {
    return <span>N/A</span>
  }

  return <span>{basisPoints / 100}%</span>
}
