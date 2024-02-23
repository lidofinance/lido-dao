import { Info, Checkbox as AragonCheckbox, GU } from '@aragon/ui'
import React, { useCallback } from 'react'

const CheckBox = React.forwardRef(({ label, field, form }, ref) => {
  const handleChange = useCallback(
    (checked) => {
      form.setFieldValue('useAdvancedV8n', checked)
    },
    [form]
  )

  return (
    <div
      css={`
        margin-bottom: ${GU * 3}px;
      `}
    >
      <label
        css={`
          display: flex;
          align-items: center;
        `}
      >
        <AragonCheckbox
          ref={ref}
          checked={field.value}
          // eslint-disable-next-line react/jsx-handler-names
          onChange={handleChange}
          css={`
            margin-right: ${GU}px;
          `}
        />
        Use advanced validation
      </label>
      <Info style={{ marginTop: 5 }} mode="warning">
        By checking this box, you agree to using an external api to check your
        signing keys for duplicates against already submitted keys and to verify
        your signatures.
      </Info>
    </div>
  )
})

export default CheckBox
