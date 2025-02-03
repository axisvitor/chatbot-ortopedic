const axios = require('axios');
const logger = require('../utils/logger');
const { NUVEMSHOP_CONFIG } = require('../../config/settings');

class NuvemshopService {
    constructor() {
        this.client = axios.create({
            baseURL: NUVEMSHOP_CONFIG.apiUrl,
            headers: {
                'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                'User-Agent': NUVEMSHOP_CONFIG.api.userAgent,
                'Content-Type': 'application/json'
            },
            timeout: NUVEMSHOP_CONFIG.api.timeout
        });

        // Adiciona interceptor para retry em caso de falha
        this.client.interceptors.response.use(
            response => response,
            async error => {
                if (!error.config || error.config.retryCount >= NUVEMSHOP_CONFIG.api.retryAttempts) {
                    return Promise.reject(error);
                }

                error.config.retryCount = (error.config.retryCount || 0) + 1;
                const delay = NUVEMSHOP_CONFIG.api.retryDelays[error.config.retryCount - 1];
                
                logger.warn('RetryingRequest', {
                    attempt: error.config.retryCount,
                    delay,
                    url: error.config.url,
                    error: error.message
                });

                await new Promise(resolve => setTimeout(resolve, delay));
                return this.client(error.config);
            }
        );
    }

    /**
     * Busca pedidos recentes com código de rastreio
     * @param {number} limit - Limite de pedidos a retornar
     * @returns {Promise<Array>} Lista de pedidos com rastreio
     */
    async getNewOrdersWithTracking(limit = NUVEMSHOP_CONFIG.validation.maxOrdersPerPage) {
        try {
            logger.info('BuscandoPedidosComRastreio', {
                limit,
                timestamp: new Date().toISOString()
            });

            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    per_page: limit,
                    fields: [
                        'id',
                        'number',
                        'status',
                        'shipping_tracking',
                        'shipping_status',
                        'created_at',
                        'updated_at'
                    ].join(','),
                    sort: '-created_at',
                    shipping_tracking_not_null: true
                }
            });

            const orders = response.data;
            logger.info('PedidosEncontrados', {
                quantidade: orders.length,
                timestamp: new Date().toISOString()
            });

            return orders;
        } catch (error) {
            logger.error('ErroBuscarPedidos', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Atualiza o código de rastreio de um pedido
     * @param {string} orderId - ID do pedido
     * @param {string} trackingCode - Novo código de rastreio
     * @param {string} trackingUrl - Nova URL de rastreio
     * @returns {Promise<Object>} Pedido atualizado
     */
    async updateOrderTracking(orderId, trackingCode, trackingUrl) {
        try {
            logger.info('AtualizandoRastreioPedido', {
                orderId,
                trackingCode,
                trackingUrl,
                timestamp: new Date().toISOString()
            });

            const response = await this.client.put(
                `/${NUVEMSHOP_CONFIG.userId}/orders/${orderId}`,
                {
                    shipping_tracking: trackingCode,
                    shipping_tracking_url: trackingUrl
                }
            );

            logger.info('RastreioPedidoAtualizado', {
                orderId,
                trackingCode,
                timestamp: new Date().toISOString()
            });

            return response.data;
        } catch (error) {
            logger.error('ErroAtualizarRastreio', {
                orderId,
                trackingCode,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Busca um pedido pelo número
     * @param {string} orderNumber - Número do pedido (ex: #123456)
     * @returns {Promise<Object|null>} Dados do pedido ou null se não encontrado
     */
    async getOrderByNumber(orderNumber) {
        try {
            // Remove # se presente
            const number = orderNumber.replace('#', '');

            logger.info('BuscandoPedido', {
                orderNumber: number,
                timestamp: new Date().toISOString()
            });

            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    q: number,
                    fields: [
                        'id',
                        'number',
                        'status',
                        'payment_status',
                        'shipping_status',
                        'shipping_tracking_number',
                        'shipping_tracking_url',
                        'total',
                        'products',
                        'customer',
                        'created_at',
                        'updated_at'
                    ].join(',')
                }
            });

            const orders = response.data;
            const order = orders.find(o => o.number === number);

            if (!order) {
                logger.info('PedidoNaoEncontrado', {
                    orderNumber: number,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Formata produtos para melhor visualização
            order.products = order.products.map(p => ({
                name: p.name,
                quantity: p.quantity,
                price: (p.price / 100).toFixed(2) // Converte centavos para reais
            }));

            logger.info('PedidoEncontrado', {
                orderId: order.id,
                orderNumber: number,
                timestamp: new Date().toISOString()
            });

            return order;

        } catch (error) {
            logger.error('ErroBuscarPedido', {
                orderNumber,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Sincroniza pedidos recentes da Nuvemshop
     * @returns {Promise<void>}
     */
    async syncOrders() {
        try {
            logger.info('IniciandoSincronizacaoPedidos', {
                timestamp: new Date().toISOString()
            });

            const orders = await this.getNewOrdersWithTracking();
            
            logger.info('SincronizacaoPedidosConcluida', {
                quantidadePedidos: orders.length,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            logger.error('ErroSincronizarPedidos', {
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { NuvemshopService };