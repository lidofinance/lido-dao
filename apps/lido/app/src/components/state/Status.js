import { useAppState, useAragonApi } from '@aragon/api-react'
import { IconConnect, IconRemove } from '@aragon/ui'
import React from 'react'
import styled from 'styled-components'
import { Controls, IconButton, ListItem, LoadableElement } from '../shared'

const StoppedStyle = styled.span`
  color: ${(props) => props.theme.negative};
`

const LiveStyle = styled.span`
  color: ${(props) => props.theme.positive};
`

const ResumeIcon = styled(IconConnect)`
  color: ${(props) => props.theme.positive};
`

const StopIcon = styled(IconRemove)`
  color: ${(props) => props.theme.negative};
`

export const Status = () => {
  const { isStopped } = useAppState()

  const { api } = useAragonApi()

  const stop = () => {
    api.stop().toPromise()
  }

  const resume = () => {
    api.resume().toPromise()
  }

  return (
    <ListItem label="Status">
      <LoadableElement value={isStopped}>
        {isStopped ? (
          <Controls>
            <StoppedStyle>Stopped</StoppedStyle>
            <IconButton label="Resume" icon={<ResumeIcon />} onClick={resume} />
          </Controls>
        ) : (
          <Controls>
            <LiveStyle>Live</LiveStyle>
            <IconButton label="Stop" icon={<StopIcon />} onClick={stop} />
          </Controls>
        )}
      </LoadableElement>
    </ListItem>
  )
}
