import { GU, useTheme } from '@aragon/ui'
import React from 'react'
import styled from 'styled-components'

const ListItemStyle = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${GU}px ${GU * 3}px ${GU}px
    ${(props) => (props.nested ? GU * 6 : GU * 3)}px;
  line-height: 40px;
  border-top: 1px solid
    ${(props) => (props.isDark ? '#2C3A58' : props.theme.border)};

  & :first-of-type {
    margin-top: 0;
    border-top: none;
  }
`

const ListItemLabel = styled.span`
  color: ${(props) =>
    props.isDark ? '#7C99D6' : props.theme.surfaceContentSecondary};
`

const ListItemValue = styled.strong`
  text-align: right;
`

export const ListItem = ({ label, children, nested }) => {
  const theme = useTheme()

  const themeDark = theme?._name === 'dark'

  return (
    <ListItemStyle nested={nested} isDark={themeDark}>
      <ListItemLabel isDark={themeDark}>{label}</ListItemLabel>
      <ListItemValue>{children}</ListItemValue>
    </ListItemStyle>
  )
}
