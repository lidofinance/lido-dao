import React from 'react'
import PropTypes from 'prop-types'
import { GU, Inside, useLayout } from '@aragon/ui'

export const Split = ({ primary, secondary, invert }) => {
    const { name: layout } = useLayout()
    const oneColumn = layout === 'small' || layout === 'medium'

    const inverted =
        (!oneColumn && invert === 'horizontal') ||
        (oneColumn && invert === 'vertical')

    const primaryContent = (
        <Inside name="Split:primary">
            <div
                css={`
          flex-grow: 1;
          margin-left: ${!oneColumn && inverted ? 2 * GU : 0}px;
          padding-top: ${oneColumn && inverted ? 2 * GU : 0}px;
        `}
            >
                {primary}
            </div>
        </Inside>
    )

    const secondaryContent = (
        <Inside name="Split:secondary">
            <div
                css={`
          flex-shrink: 0;
          flex-grow: 0;
          width: ${oneColumn ? '100%' : `${42 * GU}px`};
          margin-left: ${!oneColumn && !inverted ? 2 * GU : 0}px;
          padding-top: ${oneColumn && !inverted ? 2 * GU : 0}px;
        `}
            >
                {secondary}
            </div>
        </Inside>
    )

    return (
        <Inside name="Split">
            <div
                css={`
          display: ${oneColumn ? 'block' : 'flex'};
          padding-bottom: ${3 * GU}px;
          width: 100%;
        `}
            >
                {inverted ? secondaryContent : primaryContent}
                {inverted ? primaryContent : secondaryContent}
            </div>
        </Inside>
    )
}

Split.propTypes = {
    invert: PropTypes.oneOf(['none', 'horizontal', 'vertical']),
    primary: PropTypes.node,
    secondary: PropTypes.node,
}

Split.defaultProps = {
    invert: 'none',
}
