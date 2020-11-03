import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  quantity: '',
  pubkeys: '',
  signatures: '',
}

const validationSchema = yup.object().shape({
  quantity: yup.number().integer().min(0).required(),
  pubkeys: yup.string().required().min(1),
  signatures: yup.string().required().min(1),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(({ quantity, pubkeys, signatures }) => {
    api(quantity, pubkeys, signatures).then(() => {
      onClose()
    })
  }, [])

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
              name="quantity"
              label="Quantity"
              type="number"
              min="0"
              required
              component={TextField}
            />
            <Field
              name="pubkeys"
              label="Pubkeys"
              required
              component={TextField}
            />
            <Field
              name="signatures"
              label="Signatures"
              required
              component={TextField}
            />
            <Button
              mode="strong"
              wide
              required
              disabled={isSubmitting}
              label="Add Signing Keys"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="ADD SIGNING KEYS" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
