import { GU, useTheme } from '@aragon/ui'
import React from 'react'
import styled from 'styled-components'

const ListItemStyle = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: ${GU * 3}px 0 0 ${(props) => (props.nested ? GU * 4 : 0)}px;
  line-height: 40px;

  & :first-of-type {
    margin-top: 0;
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

  return (
    <ListItemStyle nested={nested}>
      <ListItemLabel isDark={theme?._name === 'dark'}>{label}</ListItemLabel>
      <ListItemValue>{children}</ListItemValue>
    </ListItemStyle>
  )
}
