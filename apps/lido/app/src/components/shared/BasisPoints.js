import React from 'react'
import { LoadingRing } from '@aragon/ui'
import { fromBasisPoints } from '../../utils'

export const BasisPoints = ({ basisPoints }) => {
  if (typeof basisPoints === 'undefined') {
    return <LoadingRing />
  }

  basisPoints = Number(basisPoints)
  if (Number.isNaN(basisPoints)) {
    return <span>N/A</span>
  }

  return <span>{fromBasisPoints(basisPoints)}%</span>
}
