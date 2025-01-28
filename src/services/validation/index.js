const { OrderValidator } = require('./validators/order-validator');
const logger = require('../../utils/logger');

class OrderValidationService {
    constructor(nuvemshopService, cacheService, config = {}) {
        this.validator = new OrderValidator(nuvemshopService, cacheService, config);

        logger.info('OrderValidationServiceInitialized', {
            timestamp: new Date().toISOString()
        });
    }

    // Métodos públicos (mantendo compatibilidade)
    async validateOrder(order) {
        return this.validator.validateOrder(order);
    }

    // Métodos auxiliares (mantendo compatibilidade)
    getErrors() {
        return this.validator.errors;
    }

    getWarnings() {
        return this.validator.warnings;
    }

    clearValidation() {
        this.validator._clearValidation();
    }
}

module.exports = { OrderValidationService };
