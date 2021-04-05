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
  value: yup
    .number()
    .positive()
    .required()
    .min(0)
    .max(100)
    .test('Value', `Value can have up to 4 decimal places.`, (value) => {
      const regex = /^\d{1,3}(\.\d{1,4})?$/
      return regex.test(value)
    }),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ value }) => {
      api(value * 10000).finally(() => {
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
              decrease. Please specify the value as a percentage. The value will
              automatically be converted to basis points upon submission.
              <br />
              <br />
              i.e.
              <br />
              <strong>
                100% = 1 000 000 basis points
                <br />
                1% = 10 000 basis points
                <br />
                Minimal step: 0.0001% (1 basis point)
              </strong>
            </Info>
            <Field
              name="value"
              label="Value (%)"
              type="number"
              min="0"
              step="0.0001"
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
