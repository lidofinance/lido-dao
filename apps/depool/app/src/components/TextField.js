import { Field, Info, TextInput } from '@aragon/ui'
import React from 'react'

const TextField = React.forwardRef(({ label, field, form, ...props }, ref) => {
  return (
    <Field label={label}>
      <TextInput ref={ref} wide {...field} {...props} />
      {form.errors[field.name] && (
        <Info style={{ marginTop: 5 }} mode="error">
          {form.errors[field.name]}
        </Info>
      )}
    </Field>
  )
})

export default TextField
