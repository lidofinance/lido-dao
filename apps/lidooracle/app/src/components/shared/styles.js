import { Box, GU, Info } from '@aragon/ui'
import styled, { keyframes } from 'styled-components'

export const InfoSpaced = styled(Info)`
  margin: ${GU * 3}px 0;
`

export const FormSpaced = styled.form`
  margin-top: ${3 * GU}px;
`

export const Controls = styled.div`
  display: inline-flex;
  justify-content: flex-start;
  align-items: center;

  & > :first-child {
    margin-right: ${GU * 2}px;
  }
`

export const BoxUnpadded = styled(Box)`
  & > div {
    padding: 0;
  }
`

const blink = keyframes`
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
`

export const Dot = styled.span`
  margin-right: ${GU}px;
  color: ${(props) =>
    props.active ? props.theme.positive : props.theme.negative};
  animation: ${blink} 0.5s infinite alternate;
`