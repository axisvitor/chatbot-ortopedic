const winston = require('winston');
const { format } = winston;
const { env, LOGGING_CONFIG } = require('../config/settings');
require('dotenv').config();

class Logger {
    constructor() {
        this.logger = winston.createLogger({
            level: LOGGING_CONFIG.level || 'info',
            format: format.combine(
                format.timestamp(),
                format.metadata(),
                format.json()
            ),
            defaultMeta: { service: 'ortopedic-bot' },
            transports: [
                new winston.transports.Console({
                    format: format.combine(
                        format.colorize(),
                        format.simple()
                    )
                }),
                new winston.transports.File({ 
                    filename: 'logs/error.log', 
                    level: 'error',
                    maxsize: 5242880, // 5MB
                    maxFiles: 5
                }),
                new winston.transports.File({ 
                    filename: 'logs/combined.log',
                    maxsize: 10485760, // 10MB
                    maxFiles: 5
                })
            ]
        });

        // Adiciona handler para erros não tratados
        process.on('uncaughtException', (error) => {
            this.error('UncaughtException', error);
            process.exit(1);
        });

        process.on('unhandledRejection', (error) => {
            this.error('UnhandledRejection', error);
        });
    }

    _formatError(error) {
        if (error instanceof Error) {
            return {
                message: error.message,
                stack: error.stack,
                ...error
            };
        }
        return error;
    }

    _formatMessage(message, meta = {}) {
        return {
            timestamp: new Date().toISOString(),
            message,
            ...meta
        };
    }

    info(message, meta = {}) {
        this.logger.info(this._formatMessage(message, meta));
    }

    error(message, error, meta = {}) {
        this.logger.error(this._formatMessage(message, {
            error: this._formatError(error),
            ...meta
        }));
    }

    warn(message, meta = {}) {
        this.logger.warn(this._formatMessage(message, meta));
    }

    debug(message, meta = {}) {
        this.logger.debug(this._formatMessage(message, meta));
    }

    // Métodos específicos para nosso contexto
    logOrderCheck(orderNumber, result, duration, meta = {}) {
        this.info('OrderCheck', {
            orderNumber,
            found: !!result,
            durationMs: duration,
            ...meta
        });
    }

    logTrackingCheck(trackingCode, status, duration, meta = {}) {
        this.info('TrackingCheck', {
            trackingCode,
            status,
            durationMs: duration,
            ...meta
        });
    }

    logPaymentProof(threadId, status, meta = {}) {
        this.info('PaymentProof', {
            threadId,
            status,
            ...meta
        });
    }

    logAssistantResponse(threadId, functionsCalled, duration, meta = {}) {
        this.info('AssistantResponse', {
            threadId,
            functionsCalled,
            durationMs: duration,
            ...meta
        });
    }
}

// Singleton
const logger = new Logger();
module.exports = logger;
