import { Help } from '@aragon/ui'
import React from 'react'
import styled from 'styled-components'

const TooltipStyle = styled.div`
  display: flex;
  justify-content: flex-start;
  align-items: center;
`

const TooltipLabel = styled.span`
  margin-right: 8px;
`

export const Tooltip = ({ tooltip, children }) => {
  return (
    <TooltipStyle>
      <TooltipLabel>{children}</TooltipLabel>
      {tooltip && <Help hint={children}>{tooltip}</Help>}
    </TooltipStyle>
  )
}
