import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'
import Info from '@aragon/ui/dist/Info'

const initialValues = {
  value: '',
}

const validationSchema = yup.object().shape({
  value: yup.number().integer().required().min(0),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ value }) => {
      api(value).finally(() => {
        onClose()
      })
    },
    [api, onClose]
  )

  return (
    <Formik
      initialValues={initialValues}
      validationSchema={validationSchema}
      onSubmit={onSubmit}
      validateOnBlur
    >
      {({ submitForm, isSubmitting }) => {
        return (
          <form
            css={`
              margin-top: ${3 * GU}px;
            `}
            onSubmit={(e) => {
              e.preventDefault()
              submitForm()
            }}
          >
            <Info
              title="Action"
              css={`
                margin-bottom: ${3 * GU}px;
              `}
            >
              This action will set a new allowed beacon balance relative
              decrease.
            </Info>
            <Field
              name="value"
              label="Value"
              type="number"
              min="0"
              required
              component={TextField}
            />
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting}
              label="Change Decrease"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="Change Relative Decrease" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
