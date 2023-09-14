import { ContextMenuItem, GU, useTheme } from '@aragon/ui'
import React from 'react'

export default function MenuItem({ onClick, icon, label }) {
  const theme = useTheme()

  return (
    <ContextMenuItem onClick={onClick}>
      <span
        css={`
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          color: ${theme.surfaceContentSecondary};

          svg {
            color: ${theme.accent};
          }
        `}
      >
        {icon}
      </span>
      <span
        css={`
          margin-left: ${1 * GU}px;
        `}
      >
        {label}
      </span>
    </ContextMenuItem>
  )
}
