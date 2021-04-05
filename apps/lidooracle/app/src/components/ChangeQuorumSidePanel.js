import { Button, GU, SidePanel } from '@aragon/ui'
import React, { useCallback } from 'react'
import { Formik, Field } from 'formik'
import * as yup from 'yup'
import TextField from './TextField'
import Info from '@aragon/ui/dist/Info'

const initialValues = {
  quorum: '',
}

const validationSchema = yup.object().shape({
  quorum: yup.number().integer().required().min(0),
})

function PanelContent({ api, onClose }) {
  const onSubmit = useCallback(
    ({ quorum }) => {
      api(quorum).finally(() => {
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
              This action will set a new quorum value.
            </Info>
            <Field
              name="quorum"
              label="Quorum"
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
              label="Change Quorum"
              type="submit"
            />
          </form>
        )
      }}
    </Formik>
  )
}

export default (props) => (
  <SidePanel title="ADD ORACLE MEMBER" {...props}>
    <PanelContent {...props} />
  </SidePanel>
)
