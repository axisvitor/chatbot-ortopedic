const { ValidationBase } = require('../base');
const { OrderValidationRules } = require('../rules/order-rules');
const logger = require('../../../utils/logger');

class OrderValidator extends ValidationBase {
    constructor(nuvemshopService, cacheService, config = {}) {
        super(config);
        
        this.nuvemshopService = nuvemshopService;
        this.cacheService = cacheService;
        this.rules = new OrderValidationRules(config);
    }

    /**
     * Valida pedido completo
     * @param {Object} order Dados do pedido
     * @returns {Promise<Object>} Resultado da validação
     */
    async validateOrder(order) {
        try {
            this._clearValidation();

            // Valida estrutura básica
            if (!this._validateBasicStructure(order)) {
                return this._getValidationResult();
            }

            // Valida status
            if (order.status) {
                const currentStatus = await this._getCurrentOrderStatus(order.id);
                this.rules.validateStatus(currentStatus, order.status);
            }

            // Valida dados do cliente
            this.rules.validateCustomer(order.customer);

            // Valida dados de pagamento
            this.rules.validatePayment(order.payment);

            // Valida dados de envio
            this.rules.validateShipping(order.shipping);

            // Valida produtos
            if (order.products) {
                await this._validateProductsAvailability(order.products);
            }

            // Adiciona warnings e erros das regras
            this.errors.push(...this.rules.errors);
            this.warnings.push(...this.rules.warnings);

            return this._getValidationResult();

        } catch (error) {
            logger.error('OrderValidationError', {
                orderId: order?.id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            this._addError('VALIDATION_ERROR',
                'Erro ao validar pedido',
                { message: error.message }
            );

            return this._getValidationResult();
        }
    }

    /**
     * Valida estrutura básica do pedido
     * @private
     */
    _validateBasicStructure(order) {
        if (!order || typeof order !== 'object') {
            this._addError('INVALID_ORDER_DATA',
                'Dados do pedido inválidos ou não fornecidos'
            );
            return false;
        }

        const requiredFields = ['customer', 'payment', 'shipping', 'products'];
        const missingFields = requiredFields.filter(field => !order[field]);

        if (missingFields.length > 0) {
            this._addError('MISSING_REQUIRED_FIELDS',
                'Campos obrigatórios não fornecidos',
                { missing: missingFields }
            );
            return false;
        }

        return true;
    }

    /**
     * Obtém status atual do pedido
     * @private
     */
    async _getCurrentOrderStatus(orderId) {
        try {
            const cacheKey = this._generateCacheKey('order', 'status', orderId);

            // Tenta buscar do cache
            if (this.config.cacheEnabled) {
                const cachedStatus = await this.cacheService.get(cacheKey);
                if (cachedStatus) {
                    return cachedStatus;
                }
            }

            // Busca da API
            const order = await this._withRetry(() => 
                this.nuvemshopService.getOrder(orderId)
            );

            // Salva no cache
            if (this.config.cacheEnabled) {
                await this.cacheService.set(cacheKey, order.status, this.config.cacheTTL);
            }

            return order.status;

        } catch (error) {
            logger.error('GetOrderStatusError', {
                orderId,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Valida disponibilidade dos produtos
     * @private
     */
    async _validateProductsAvailability(products) {
        try {
            // Valida estrutura dos produtos
            if (!this.rules.validateProducts(products)) {
                return;
            }

            // Verifica disponibilidade de cada produto
            for (const item of products) {
                await this._checkProductAvailability(item);
            }

        } catch (error) {
            logger.error('ProductsValidationError', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Verifica disponibilidade de um produto
     * @private
     */
    async _checkProductAvailability(item) {
        try {
            const cacheKey = this._generateCacheKey('product', 'stock', item.id);

            // Tenta buscar do cache
            let stock = null;
            if (this.config.cacheEnabled) {
                const cachedStock = await this.cacheService.get(cacheKey);
                if (cachedStock !== null) {
                    stock = parseInt(cachedStock);
                }
            }

            // Se não está em cache, busca da API
            if (stock === null) {
                const product = await this._withRetry(() =>
                    this.nuvemshopService.getProduct(item.id)
                );
                stock = product.stock;

                // Salva no cache
                if (this.config.cacheEnabled) {
                    await this.cacheService.set(cacheKey, stock.toString(), this.config.cacheTTL);
                }
            }

            // Verifica disponibilidade
            if (stock < item.quantity) {
                this._addError('INSUFFICIENT_STOCK',
                    'Quantidade solicitada maior que estoque disponível',
                    {
                        productId: item.id,
                        requested: item.quantity,
                        available: stock
                    }
                );
            } else if (stock < item.quantity * 2) {
                this._addWarning('LOW_STOCK',
                    'Estoque baixo para o produto',
                    {
                        productId: item.id,
                        stock,
                        threshold: item.quantity * 2
                    }
                );
            }

        } catch (error) {
            logger.error('ProductAvailabilityError', {
                productId: item.id,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { OrderValidator };
