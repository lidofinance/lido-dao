const { createLogger, format, transports } = require('winston')

export const logger = createLogger({
  level: 'debug',
  format: format.combine(format.errors({ stack: true }), format.splat(), format.json()),
  transports: [
    new transports.File({ filename: 'quick-start-error.log', level: 'error' }),
    new transports.File({ filename: 'quick-start-combined.log' })
  ]
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  )
}
