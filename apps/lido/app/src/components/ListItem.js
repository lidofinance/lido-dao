import { GU, useTheme } from '@aragon/ui'
import React from 'react'

export function ListItem({ children, subBullet }) {
  const theme = useTheme()

  return (
    <li
      css={`
        display: flex;
        justify-content: space-between;
        align-items: center;
        list-style: none;
        height: 40px;
        margin-left: ${subBullet ? '24px' : '0px'};

        & + & {
          margin-top: ${2 * GU}px;
        }

        > span:nth-child(1) {
          color: ${theme.surfaceContentSecondary};
        }
        > span:nth-child(2) {
          opacity: 0;
          width: 10px;
        }
        > span:nth-child(3) {
          flex-shrink: 1;
        }
      `}
    >
      {children}
    </li>
  )
}
