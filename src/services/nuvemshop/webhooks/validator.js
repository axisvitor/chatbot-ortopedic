const crypto = require('crypto');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const logger = require('../../../../utils/logger');

class WebhookValidator {
    constructor() {
        this.config = NUVEMSHOP_CONFIG.webhook;
    }

    /**
     * Valida assinatura do webhook
     * @param {string} signature Assinatura do webhook
     * @param {string} payload Payload do webhook
     * @returns {boolean} Se a assinatura é válida
     */
    validateSignature(signature, payload) {
        try {
            if (!signature || !payload) {
                logger.warn('MissingWebhookData', {
                    hasSignature: !!signature,
                    hasPayload: !!payload,
                    timestamp: new Date().toISOString()
                });
                return false;
            }

            const expectedSignature = crypto
                .createHmac('sha256', this.config.secret)
                .update(payload)
                .digest('hex');

            const isValid = crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature)
            );

            if (!isValid) {
                logger.warn('InvalidWebhookSignature', {
                    receivedSignature: signature,
                    expectedSignature,
                    timestamp: new Date().toISOString()
                });
            }

            return isValid;

        } catch (error) {
            logger.error('WebhookValidationError', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Valida tópico do webhook
     * @param {string} topic Tópico do webhook
     * @returns {boolean} Se o tópico é válido
     */
    validateTopic(topic) {
        const validTopics = [
            'orders/created',
            'orders/updated',
            'orders/paid',
            'orders/fulfilled',
            'orders/cancelled',
            'products/created',
            'products/updated',
            'products/deleted',
            'customers/created',
            'customers/updated',
            'customers/deleted',
            'app/uninstalled'
        ];

        const isValid = validTopics.includes(topic);

        if (!isValid) {
            logger.warn('InvalidWebhookTopic', {
                topic,
                validTopics,
                timestamp: new Date().toISOString()
            });
        }

        return isValid;
    }

    /**
     * Valida estrutura do payload
     * @param {string} topic Tópico do webhook
     * @param {Object} payload Payload do webhook
     * @returns {boolean} Se o payload é válido
     */
    validatePayload(topic, payload) {
        try {
            if (!payload || typeof payload !== 'object') {
                logger.warn('InvalidPayloadStructure', {
                    topic,
                    payload,
                    timestamp: new Date().toISOString()
                });
                return false;
            }

            // Validações específicas por tópico
            switch (topic.split('/')[0]) {
                case 'orders':
                    return this._validateOrderPayload(payload);
                case 'products':
                    return this._validateProductPayload(payload);
                case 'customers':
                    return this._validateCustomerPayload(payload);
                case 'app':
                    return this._validateAppPayload(payload);
                default:
                    return false;
            }

        } catch (error) {
            logger.error('PayloadValidationError', {
                topic,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Valida payload de pedido
     * @private
     */
    _validateOrderPayload(payload) {
        const requiredFields = ['id', 'number', 'status', 'customer'];
        return requiredFields.every(field => payload.hasOwnProperty(field));
    }

    /**
     * Valida payload de produto
     * @private
     */
    _validateProductPayload(payload) {
        const requiredFields = ['id', 'name', 'variants'];
        return requiredFields.every(field => payload.hasOwnProperty(field));
    }

    /**
     * Valida payload de cliente
     * @private
     */
    _validateCustomerPayload(payload) {
        const requiredFields = ['id', 'email'];
        return requiredFields.every(field => payload.hasOwnProperty(field));
    }

    /**
     * Valida payload de app
     * @private
     */
    _validateAppPayload(payload) {
        const requiredFields = ['store_id'];
        return requiredFields.every(field => payload.hasOwnProperty(field));
    }
}

module.exports = { WebhookValidator };
