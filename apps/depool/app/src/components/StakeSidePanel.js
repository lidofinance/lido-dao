import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  address: '',
}

const validationSchema = yup.object().shape({
  address: yup.string().required().min(1),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ address }) => {
      api(address).then(() => {
        onClose()
      })
    },
    [api]
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
              name="address"
              label="Address"
              required
              component={TextField}
            />
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting}
              label="STAKE"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="STAKE ETH" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
