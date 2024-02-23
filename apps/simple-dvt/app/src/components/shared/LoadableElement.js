import React from 'react'
import { LoadingRing } from '@aragon/ui'

export const LoadableElement = ({ value, children }) => {
  if (typeof value === 'undefined') {
    return <LoadingRing />
  }

  return <span>{children}</span>
}
