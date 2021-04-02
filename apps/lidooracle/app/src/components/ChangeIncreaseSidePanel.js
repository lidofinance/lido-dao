import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

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
              label="Change Increase"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="Change Annual Increase" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
