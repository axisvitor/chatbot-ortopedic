const { NuvemshopBase } = require('../base');
const logger = require('../../../utils/logger');

class OrderHandler extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
    }

    /**
     * Processa novo pedido
     */
    async handleNewOrder(order) {
        try {
            logger.info('ProcessingNewOrder', {
                orderId: order.id,
                timestamp: new Date().toISOString()
            });

            // Validação inicial
            if (!this._validateOrderData(order)) {
                return {
                    success: false,
                    message: 'Dados do pedido inválidos'
                };
            }

            // Processa pagamento
            await this._processPayment(order);

            // Atualiza estoque
            await this._updateInventory(order);

            // Notifica cliente
            await this._notifyCustomer(order);

            return {
                success: true,
                message: 'Pedido processado com sucesso'
            };

        } catch (error) {
            logger.error('NewOrderError', {
                orderId: order.id,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao processar pedido',
                error: error.message
            };
        }
    }

    /**
     * Processa atualização de pedido
     */
    async handleOrderUpdate(orderId, updates) {
        try {
            logger.info('ProcessingOrderUpdate', {
                orderId,
                updates,
                timestamp: new Date().toISOString()
            });

            // Valida atualizações
            if (!this._validateUpdates(updates)) {
                return {
                    success: false,
                    message: 'Dados de atualização inválidos'
                };
            }

            // Atualiza pedido
            await this._makeRequest('PUT', `/orders/${orderId}`, {
                data: updates
            });

            // Invalida cache
            const cacheKey = this._generateCacheKey('order', orderId);
            await this.cacheService.del(cacheKey);

            return {
                success: true,
                message: 'Pedido atualizado com sucesso'
            };

        } catch (error) {
            logger.error('OrderUpdateError', {
                orderId,
                updates,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao atualizar pedido',
                error: error.message
            };
        }
    }

    /**
     * Processa cancelamento de pedido
     */
    async handleOrderCancellation(orderId, reason) {
        try {
            logger.info('ProcessingOrderCancellation', {
                orderId,
                reason,
                timestamp: new Date().toISOString()
            });

            // Cancela pedido
            await this._makeRequest('PUT', `/orders/${orderId}`, {
                data: {
                    status: 'cancelled',
                    cancel_reason: reason
                }
            });

            // Atualiza estoque
            await this._restoreInventory(orderId);

            // Notifica cliente
            await this._notifyCancellation(orderId, reason);

            // Invalida cache
            const cacheKey = this._generateCacheKey('order', orderId);
            await this.cacheService.del(cacheKey);

            return {
                success: true,
                message: 'Pedido cancelado com sucesso'
            };

        } catch (error) {
            logger.error('OrderCancellationError', {
                orderId,
                reason,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });

            return {
                success: false,
                message: 'Erro ao cancelar pedido',
                error: error.message
            };
        }
    }

    // Métodos privados de validação e processamento

    _validateOrderData(order) {
        return order && order.id && order.customer && order.items;
    }

    _validateUpdates(updates) {
        const allowedFields = ['status', 'shipping_status', 'tracking_number'];
        return updates && Object.keys(updates).every(key => allowedFields.includes(key));
    }

    async _processPayment(order) {
        // Implementação do processamento de pagamento
        logger.info('ProcessingPayment', {
            orderId: order.id,
            amount: order.total,
            timestamp: new Date().toISOString()
        });
    }

    async _updateInventory(order) {
        // Implementação da atualização de estoque
        for (const item of order.items) {
            await this._makeRequest('PUT', `/products/${item.product_id}`, {
                data: {
                    stock: item.new_stock
                }
            });
        }
    }

    async _restoreInventory(orderId) {
        // Implementação da restauração de estoque
        const order = await this._makeRequest('GET', `/orders/${orderId}`);
        for (const item of order.items) {
            await this._makeRequest('PUT', `/products/${item.product_id}`, {
                data: {
                    stock: item.restore_stock
                }
            });
        }
    }

    async _notifyCustomer(order) {
        // Implementação da notificação do cliente
        logger.info('NotifyingCustomer', {
            orderId: order.id,
            customer: order.customer.email,
            timestamp: new Date().toISOString()
        });
    }

    async _notifyCancellation(orderId, reason) {
        // Implementação da notificação de cancelamento
        const order = await this._makeRequest('GET', `/orders/${orderId}`);
        logger.info('NotifyingCancellation', {
            orderId,
            customer: order.customer.email,
            reason,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = { OrderHandler };
