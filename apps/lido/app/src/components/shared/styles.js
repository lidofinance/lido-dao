import { Box, GU, Info } from '@aragon/ui'
import styled from 'styled-components'

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
