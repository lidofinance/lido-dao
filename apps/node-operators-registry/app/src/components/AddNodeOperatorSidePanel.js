import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  name: '',
  address: '',
  limit: '',
}

const validationSchema = yup.object().shape({
  name: yup.string().required().min(1),
  address: yup.string().required().min(1),
  limit: yup.number().integer().min(0).required(),
})

function PanelContent({ addNodeOperatorApi, onClose }) {
  const onSubmit = useCallback(({ name, address, limit }) => {
    addNodeOperatorApi(name, address, limit).then(() => {
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
            <Field name="name" label="Name" required component={TextField} />
            <Field
              name="address"
              label="Address"
              required
              component={TextField}
            />
            <Field
              name="limit"
              label="Limit"
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
              label="Add Node Operator"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="ADD NODE OPERATOR" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
