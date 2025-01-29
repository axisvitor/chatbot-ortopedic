const logger = require('../../../utils/logger');
const { WebhookValidator } = require('./validator');
const { OrderService } = require('../services/order');
const { ProductService } = require('../services/product');
const { CustomerService } = require('../services/customer');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');

class WebhookHandler {
    constructor(cacheService) {
        this.validator = new WebhookValidator();
        this.orderService = new OrderService(cacheService);
        this.productService = new ProductService(cacheService);
        this.customerService = new CustomerService(cacheService);
    }

    /**
     * Processa webhook recebido
     * @param {Object} payload - Dados do webhook
     * @param {string} signature - Assinatura do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleWebhook(payload, signature) {
        try {
            // Valida assinatura
            if (!this.validator.validateSignature(signature, payload)) {
                logger.error('AssinaturaWebhookInvalida', {
                    timestamp: new Date().toISOString()
                });
                throw new Error('Assinatura do webhook inválida');
            }

            // Valida payload
            if (!this.validator.validatePayload(payload)) {
                logger.error('PayloadWebhookInvalido', {
                    timestamp: new Date().toISOString()
                });
                throw new Error('Payload do webhook inválido');
            }

            // Processa evento
            const { event, topic } = payload;
            
            logger.info('ProcessandoWebhook', {
                evento: event,
                topico: topic,
                timestamp: new Date().toISOString()
            });

            switch (topic) {
                case 'orders/created':
                    return await this.handleOrderCreated(payload);
                case 'orders/paid':
                    return await this.handleOrderPaid(payload);
                case 'orders/fulfilled':
                    return await this.handleOrderFulfilled(payload);
                case 'orders/cancelled':
                    return await this.handleOrderCancelled(payload);
                case 'products/created':
                    return await this.handleProductCreated(payload);
                case 'products/updated':
                    return await this.handleProductUpdated(payload);
                case 'products/deleted':
                    return await this.handleProductDeleted(payload);
                case 'customers/created':
                    return await this.handleCustomerCreated(payload);
                case 'customers/updated':
                    return await this.handleCustomerUpdated(payload);
                default:
                    logger.warn('TopicoWebhookNaoSuportado', {
                        topico: topic,
                        timestamp: new Date().toISOString()
                    });
                    return { success: true, message: 'Tópico não processado' };
            }
        } catch (error) {
            logger.error('ErroProcessarWebhook', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de pedido criado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleOrderCreated(payload) {
        try {
            const { order } = payload;
            
            // Invalida cache de pedidos
            await this.orderService.invalidateCache('orders');
            
            // Notifica sobre novo pedido
            logger.info('PedidoCriado', {
                numero: order.number,
                cliente: order.customer?.name,
                total: order.total,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Pedido processado com sucesso',
                data: {
                    orderNumber: order.number,
                    status: order.status
                }
            };
        } catch (error) {
            logger.error('ErroProcessarPedidoCriado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de pedido pago
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleOrderPaid(payload) {
        try {
            const { order } = payload;
            
            // Invalida cache do pedido
            await this.orderService.invalidateCache('orders');
            
            // Notifica sobre pagamento
            logger.info('PedidoPago', {
                numero: order.number,
                cliente: order.customer?.name,
                total: order.total,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Pagamento processado com sucesso',
                data: {
                    orderNumber: order.number,
                    paymentStatus: order.payment_status
                }
            };
        } catch (error) {
            logger.error('ErroProcessarPedidoPago', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de pedido enviado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleOrderFulfilled(payload) {
        try {
            const { order } = payload;
            
            // Invalida cache do pedido
            await this.orderService.invalidateCache('orders');
            
            // Notifica sobre envio
            logger.info('PedidoEnviado', {
                numero: order.number,
                cliente: order.customer?.name,
                rastreio: order.shipping_tracking_number,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Envio processado com sucesso',
                data: {
                    orderNumber: order.number,
                    trackingNumber: order.shipping_tracking_number
                }
            };
        } catch (error) {
            logger.error('ErroProcessarPedidoEnviado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de pedido cancelado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleOrderCancelled(payload) {
        try {
            const { order } = payload;
            
            // Invalida cache do pedido
            await this.orderService.invalidateCache('orders');
            
            // Notifica sobre cancelamento
            logger.info('PedidoCancelado', {
                numero: order.number,
                cliente: order.customer?.name,
                motivo: order.cancel_reason,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Cancelamento processado com sucesso',
                data: {
                    orderNumber: order.number,
                    cancelReason: order.cancel_reason
                }
            };
        } catch (error) {
            logger.error('ErroProcessarPedidoCancelado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de produto criado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleProductCreated(payload) {
        try {
            const { product } = payload;
            
            // Invalida cache de produtos
            await this.productService.invalidateCache('products');
            
            // Notifica sobre novo produto
            logger.info('ProdutoCriado', {
                id: product.id,
                nome: product.name,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Produto processado com sucesso',
                data: {
                    productId: product.id,
                    name: product.name
                }
            };
        } catch (error) {
            logger.error('ErroProcessarProdutoCriado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de produto atualizado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleProductUpdated(payload) {
        try {
            const { product } = payload;
            
            // Invalida cache do produto
            await this.productService.invalidateCache('products');
            
            // Notifica sobre atualização
            logger.info('ProdutoAtualizado', {
                id: product.id,
                nome: product.name,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Atualização processada com sucesso',
                data: {
                    productId: product.id,
                    name: product.name
                }
            };
        } catch (error) {
            logger.error('ErroProcessarProdutoAtualizado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de produto excluído
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleProductDeleted(payload) {
        try {
            const { product } = payload;
            
            // Invalida cache do produto
            await this.productService.invalidateCache('products');
            
            // Notifica sobre exclusão
            logger.info('ProdutoExcluido', {
                id: product.id,
                nome: product.name,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Exclusão processada com sucesso',
                data: {
                    productId: product.id,
                    name: product.name
                }
            };
        } catch (error) {
            logger.error('ErroProcessarProdutoExcluido', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de cliente criado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleCustomerCreated(payload) {
        try {
            const { customer } = payload;
            
            // Invalida cache de clientes
            await this.customerService.invalidateCache('customers');
            
            // Notifica sobre novo cliente
            logger.info('ClienteCriado', {
                id: customer.id,
                nome: customer.name,
                email: customer.email,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Cliente processado com sucesso',
                data: {
                    customerId: customer.id,
                    name: customer.name
                }
            };
        } catch (error) {
            logger.error('ErroProcessarClienteCriado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Processa webhook de cliente atualizado
     * @param {Object} payload - Dados do webhook
     * @returns {Promise<Object>} Resultado do processamento
     */
    async handleCustomerUpdated(payload) {
        try {
            const { customer } = payload;
            
            // Invalida cache do cliente
            await this.customerService.invalidateCache('customers');
            
            // Notifica sobre atualização
            logger.info('ClienteAtualizado', {
                id: customer.id,
                nome: customer.name,
                email: customer.email,
                timestamp: new Date().toISOString()
            });

            return {
                success: true,
                message: 'Atualização processada com sucesso',
                data: {
                    customerId: customer.id,
                    name: customer.name
                }
            };
        } catch (error) {
            logger.error('ErroProcessarClienteAtualizado', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { WebhookHandler };
