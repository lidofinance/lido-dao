import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'
import Info from '@aragon/ui/dist/Info'

const initialValues = {
  address: '',
}

const validationSchema = yup.object().shape({
  address: yup.string().required().min(1),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ address }) => {
      api(address).finally(() => {
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
              This action will change the address which receives the reports.
            </Info>
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
              label="Set address"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="CHANGE BEACON REPORT RECEIVER" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
