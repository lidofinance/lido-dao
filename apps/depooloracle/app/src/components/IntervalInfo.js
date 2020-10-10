import { Bar, Box, Button, GU, useTheme, useToast } from '@aragon/ui'
import { Field, Formik } from 'formik'
import React, { useCallback } from 'react'
import * as yup from 'yup'
import TextField from './TextField'

const initialValues = {
  timestamp: '',
}

const validationSchema = yup.object().shape({
  timestamp: yup.number().integer().required().min(0),
})

export default function IntervalInfo({
  duration,
  currentInterval,
  update,
  api,
}) {
  const theme = useTheme()
  const toast = useToast()

  const onSubmit = useCallback(
    ({ timestamp }, { resetForm }) => {
      api(timestamp)
        .then((response) => {
          toast(`The report interval for ${timestamp} is ${response} seconds.`)
          resetForm()
        })
        .catch(() => {
          toast(`Invalid timestamp: ${timestamp}.`)
          resetForm()
        })
    },
    [api, toast]
  )

  return (
    <Box
      heading="Report Interval Duration (sec)"
      css={`
        & > div {
          padding: 0;
        }
      `}
    >
      <p
        css={`
          font-size: 1.5rem;
          text-align: center;
          margin-top: 20px;
          margin-bottom: 20px;
        `}
      >
        {duration}
      </p>
      <h1
        css={`
          border-top: 1px solid ${theme.border};
          border-bottom: 1px solid ${theme.border};
          color: ${theme.surfaceContentSecondary};
          line-height: 1.5;
          font-weight: 600;
          font-size: 12px;
          display: flex;
          align-items: center;
          height: 32px;
          padding: 0 24px;
          text-transform: uppercase;
        `}
      >
        Current Interval
      </h1>
      <p
        css={`
          font-size: 1.5rem;
          text-align: center;
          margin-top: 20px;
          margin-bottom: 20px;
        `}
      >
        {currentInterval}
      </p>
      <div
        css={`
          padding: 0 24px;
          margin-bottom: 24px;
        `}
      >
        <Button mode="strong" wide onClick={update}>
          Update
        </Button>
      </div>
      <Formik
        initialValues={initialValues}
        validationSchema={validationSchema}
        onSubmit={onSubmit}
        validateOnBlur={false}
      >
        {({ submitForm, isSubmitting }) => (
          <form
            css={`
              border-top: 1px solid ${theme.border};
              padding: 24px;
            `}
            onSubmit={(e) => {
              e.preventDefault()
              submitForm()
            }}
          >
            <Field
              name="timestamp"
              label="Timestamp"
              required
              component={TextField}
              type="number"
              min="0"
            />
            <Button
              disabled={isSubmitting}
              wide
              mode="strong"
              type="submit"
              label="Get"
            />
          </form>
        )}
      </Formik>
    </Box>
  )
}
