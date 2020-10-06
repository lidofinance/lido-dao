import { GU, useTheme } from '@aragon/ui'
import React from 'react'

export default function ListItem({ children }) {
  const theme = useTheme()
  return (
    <li
      css={`
        display: flex;
        justify-content: space-between;
        list-style: none;
        color: ${theme.surfaceContent};

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
        > strong {
          text-transform: uppercase;
        }
      `}
    >
      {children}
    </li>
  )
}
