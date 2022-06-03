import { useAppState, useAragonApi } from '@aragon/api-react'
import { Button, IconEdit, IdentityBadge, SidePanel } from '@aragon/ui'
import { Field, Form, Formik } from 'formik'
import React, { useState } from 'react'
import * as yup from 'yup'
import BN from 'bn.js'
import {
  IconButton,
  InfoSpaced,
  ListItem,
  LoadableElement,
  TextField,
} from '../shared'
import {
  capitalizeFirstLetter,
  fromBasisPoints,
  sum,
  toBasisPoints,
} from '../../utils'

const TREASURY = 'treasury'
const INSURANCE = 'insurance'
const OPERATORS = 'operators'

const initialValues = {
  [TREASURY]: '',
  [INSURANCE]: '',
  [OPERATORS]: '',
}

const getFieldSchema = (fieldName) => {
  return yup
    .number(`${capitalizeFirstLetter(fieldName)} must be a number.`)
    .required(`${capitalizeFirstLetter(fieldName)} must be a valid number.`)
    .min(
      0,
      `${capitalizeFirstLetter(fieldName)} must be greater than or equal zero.`
    )
    .max(
      100,
      `${capitalizeFirstLetter(fieldName)} must be less than or equal 100. `
    )
    .test(
      fieldName,
      `${capitalizeFirstLetter(
        fieldName
      )} must a number with up to 2 optional decimal places.`,
      (value) => {
        const regex = /^\d{1,3}(\.\d{1,2})?$/
        return regex.test(value)
      }
    )
}

const validationSchema = yup
  .object()
  .shape({
    [TREASURY]: getFieldSchema(TREASURY),
    [INSURANCE]: getFieldSchema(INSURANCE),
    [OPERATORS]: getFieldSchema(OPERATORS),
  })
  .test({
    name: 'total',
    test: function ({ operators, insurance, treasury }) {
      const operatorsBps = toBasisPoints(operators)
      const insuranceBps = toBasisPoints(insurance)
      const treasuryBps = toBasisPoints(treasury)

      const total = sum(operatorsBps, insuranceBps, treasuryBps)
      const totalEquals10000 = new BN(total).eq(new BN(10000))

      if (totalEquals10000) return true

      return this.createError({
        path: 'total',
        message: 'All fields must add up to 100%',
      })
    },
  })

export const FeeDistribution = () => {
  const { api } = useAragonApi()
  const { feeDistribution, treasury, operators, insuranceFund } = useAppState()

  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const openSidePanel = () => setSidePanelOpen(true)
  const closeSidePanel = () => setSidePanelOpen(false)

  const submit = ({ treasury, insurance, operators }) => {
    const insuranceBps = toBasisPoints(insurance)
    const treasuryBps = toBasisPoints(treasury)
    const operatorsBps = toBasisPoints(operators)

    api
      .setFeeDistribution(treasuryBps, insuranceBps, operatorsBps)
      .toPromise()
      .catch(console.error)
      .finally(closeSidePanel)
  }

  return (
    <>
      <ListItem label="Fee Distribution" noBorder>
        <IconButton
          label="Edit fee distribution"
          icon={<IconEdit onClick={openSidePanel} />}
        />
      </ListItem>
      <ListItem
        label={<IdentityBadge label="Treasury" entity={treasury} />}
        nested
      >
        <LoadableElement value={feeDistribution?.treasuryFeeBasisPoints}>
          {fromBasisPoints(feeDistribution?.treasuryFeeBasisPoints)}%
        </LoadableElement>
      </ListItem>
      <ListItem
        label={<IdentityBadge label="Insurance" entity={insuranceFund} />}
        nested
      >
        <LoadableElement value={feeDistribution?.insuranceFeeBasisPoints}>
          {fromBasisPoints(feeDistribution?.insuranceFeeBasisPoints)}%
        </LoadableElement>
      </ListItem>
      <ListItem
        label={<IdentityBadge label="Operators" entity={operators} />}
        nested
      >
        <LoadableElement value={feeDistribution?.operatorsFeeBasisPoints}>
          {fromBasisPoints(feeDistribution?.operatorsFeeBasisPoints)}%
        </LoadableElement>
      </ListItem>
      <SidePanel
        opened={sidePanelOpen}
        title="Change fee"
        onClose={closeSidePanel}
      >
        <InfoSpaced title="Action">
          Reallocate the fee distribution between treasury, insurance and node
          operators. The fields must add up to 100%.
        </InfoSpaced>
        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          validateOnBlur={false}
          validateOnChange={false}
          onSubmit={submit}
        >
          {({ submitForm, isSubmitting, isValidating, errors }) => {
            const handleSubmit = (event) => {
              event.preventDefault()
              submitForm()
            }

            return (
              <Form onSubmit={handleSubmit}>
                <Field
                  name={TREASURY}
                  type="number"
                  label="Treasury fee (%)"
                  component={TextField}
                />
                <Field
                  name={INSURANCE}
                  type="number"
                  label="Insurance fee (%)"
                  component={TextField}
                />
                <Field
                  name={OPERATORS}
                  type="number"
                  label="Operators fee (%)"
                  component={TextField}
                />
                {errors.total && (
                  <InfoSpaced mode="error">{errors.total}</InfoSpaced>
                )}
                <Button
                  mode="strong"
                  wide
                  required
                  disabled={isValidating || isSubmitting}
                  label="Set fee distribution"
                  type="submit"
                />
              </Form>
            )
          }}
        </Formik>
      </SidePanel>
    </>
  )
}
