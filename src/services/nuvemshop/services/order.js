const logger = require('../../../utils/logger');
const { NuvemshopBase } = require('../base');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');

class OrderService extends NuvemshopBase {
    constructor(cacheService) {
        super(cacheService);
        
        if (!cacheService) {
            logger.warn('[NuvemshopOrder] Iniciado sem serviço de cache', {
                timestamp: new Date().toISOString()
            });
        } else {
            logger.info('[NuvemshopOrder] Iniciado com serviço de cache', {
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Busca pedido por número
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object>} Pedido encontrado
     */
    async getOrderByNumber(orderNumber) {
        try {
            logger.debug('BuscandoPedidoPorNumero', {
                numero: orderNumber,
                timestamp: new Date().toISOString()
            });
            
            // Remove caracteres não numéricos
            const cleanNumber = String(orderNumber).replace(/\D/g, '');
            
            if (!cleanNumber) {
                logger.warn('NumeroPedidoInvalido', {
                    numeroOriginal: orderNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            try {
                // Busca usando o endpoint de busca geral primeiro
                const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                    params: {
                        q: cleanNumber,
                        fields: 'id,number,status,payment_status,shipping_status,customer,products,shipping_tracking_number,shipping_tracking_url'
                    }
                });

                if (response.status === 200 && response.data) {
                    // Encontra o pedido com o número exato
                    const order = Array.isArray(response.data) ? 
                        response.data.find(o => String(o.number) === cleanNumber) :
                        (String(response.data.number) === cleanNumber ? response.data : null);

                    if (order) {
                        logger.info('PedidoEncontrado', {
                            numeroOriginal: orderNumber,
                            numeroLimpo: cleanNumber,
                            id: order.id,
                            status: order.status,
                            rastreio: order.shipping_tracking_number,
                            timestamp: new Date().toISOString()
                        });
                        return order;
                    }
                }
            } catch (searchError) {
                // Log error but continue with direct search
                logger.warn('ErroBuscaGeral', {
                    erro: searchError.message,
                    numero: orderNumber,
                    timestamp: new Date().toISOString()
                });
            }
            
            try {
                // Se não encontrou, tenta buscar diretamente pelo número
                const directResponse = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                    params: {
                        number: cleanNumber,
                        fields: 'id,number,status,payment_status,shipping_status,customer,products,shipping_tracking_number,shipping_tracking_url'
                    }
                });

                if (directResponse.status === 200 && directResponse.data) {
                    const order = Array.isArray(directResponse.data) ?
                        directResponse.data[0] :
                        directResponse.data;

                    if (order) {
                        logger.info('PedidoEncontradoBuscaDireta', {
                            numeroOriginal: orderNumber,
                            numeroLimpo: cleanNumber,
                            id: order.id,
                            status: order.status,
                            rastreio: order.shipping_tracking_number,
                            timestamp: new Date().toISOString()
                        });
                        return order;
                    }
                }
            } catch (directError) {
                // Log error but don't throw yet
                logger.warn('ErroBuscaDireta', {
                    erro: directError.message,
                    numero: orderNumber,
                    timestamp: new Date().toISOString()
                });

                // If both searches failed with server errors, throw the last error
                if (directError.response?.status >= 500) {
                    throw directError;
                }
            }

            logger.warn('PedidoNaoEncontrado', {
                numero: orderNumber,
                timestamp: new Date().toISOString()
            });
            return null;
        } catch (error) {
            // Enhanced error logging
            const errorContext = {
                erro: error.message,
                status: error.response?.status,
                responseData: error.response?.data,
                stack: error.stack,
                pedido: orderNumber,
                timestamp: new Date().toISOString()
            };

            // Log different error levels based on the type of error
            if (error.response?.status >= 500) {
                logger.error('ErroServidorNuvemshop', errorContext);
            } else if (error.response?.status === 429) {
                logger.error('ErroLimiteRequisicoes', errorContext);
            } else if (!error.response) {
                logger.error('ErroRedeNuvemshop', errorContext);
            } else {
                logger.error('ErroBuscarPedido', errorContext);
            }

            // Enhance error with context
            const enhancedError = new Error(`Erro ao buscar pedido ${orderNumber}: ${error.message}`);
            enhancedError.originalError = error;
            enhancedError.orderNumber = orderNumber;
            enhancedError.status = error.response?.status;
            enhancedError.responseData = error.response?.data;

            throw enhancedError;
        }
    }

    /**
     * Busca pedidos recentes por telefone
     * @param {string} phone - Telefone para busca
     * @param {Object} options - Opções de busca
     * @returns {Promise<Array>} Lista de pedidos
     */
    async getRecentOrdersByPhone(phone, options = {}) {
        try {
            // Remove caracteres não numéricos
            const cleanPhone = phone.replace(/\D/g, '');
            
            // Busca pedidos dos últimos 30 dias
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const params = {
                created_at_min: thirtyDaysAgo.toISOString(),
                per_page: options.per_page || 10,
                page: options.page || 1,
                status: options.status || ['pending', 'paid', 'packed', 'shipped']
            };

            const { data: orders } = await this.getOrders(params);

            // Filtra por telefone
            const filteredOrders = orders.filter(order => {
                const customerPhone = order.customer?.phone?.replace(/\D/g, '');
                return customerPhone && customerPhone.includes(cleanPhone);
            });

            logger.info('PedidosEncontradosPorTelefone', {
                telefone: phone,
                total: filteredOrders.length,
                timestamp: new Date().toISOString()
            });

            return filteredOrders;
        } catch (error) {
            logger.error('ErroBuscarPedidosPorTelefone', {
                erro: error.message,
                stack: error.stack,
                telefone: phone,
                timestamp: new Date().toISOString()
            });
            return [];
        }
    }

    /**
     * Verifica se o pedido está com pagamento pendente
     * @param {string} orderId - ID do pedido
     * @returns {Promise<boolean>} true se pagamento pendente
     */
    async isOrderPendingPayment(orderId) {
        try {
            const order = await this.getOrder(orderId);
            return order && order.payment_status === 'pending';
        } catch (error) {
            logger.error('ErroVerificarStatusPagamento', {
                erro: error.message,
                stack: error.stack,
                pedidoId: orderId,
                timestamp: new Date().toISOString()
            });
            return false;
        }
    }

    /**
     * Busca pedidos com paginação
     * @param {Object} options - Opções de busca
     * @returns {Promise<Object>} Pedidos e informações de paginação
     */
    async getOrders(options = {}) {
        try {
            const cacheKey = this.generateCacheKey('orders', 'list', options);
            const cachedData = await this.getCachedData(cacheKey);
            if (cachedData) {
                return cachedData;
            }

            const params = {
                page: options.page || 1,
                per_page: Math.min(options.per_page || 50, 200),
                ...options
            };

            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, { params });
            
            const data = {
                data: response.data,
                pagination: {
                    total: parseInt(response.headers['x-total-count'] || 0),
                    currentPage: params.page,
                    perPage: params.per_page,
                    links: this.parseLinkHeader(response.headers.link)
                }
            };

            await this.setCachedData(cacheKey, data, NUVEMSHOP_CONFIG.cache.ordersTtl);

            return data;
        } catch (error) {
            logger.error('[Nuvemshop] Erro ao obter pedidos:', {
                erro: error.message,
                status: error.response?.status,
                data: error.response?.data,
                options,
                timestamp: new Date().toISOString()
            });

            // Se for erro 500, tenta novamente após 5 segundos
            if (error.response?.status === 500) {
                logger.info('[Nuvemshop] Tentando novamente em 5 segundos...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.getOrders(options);
            }

            throw error;
        }
    }

    /**
     * Busca detalhes específicos do pedido
     */
    async getOrderTracking(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_tracking || null;
    }

    async getOrderTotal(orderId) {
        const order = await this.getOrder(orderId);
        return order?.total || 0;
    }

    async getOrderPaymentStatus(orderId) {
        const order = await this.getOrder(orderId);
        return order?.payment_status || null;
    }

    async getOrderFinancialStatus(orderId) {
        const order = await this.getOrder(orderId);
        return order?.financial_status || null;
    }

    async getOrderShippingAddress(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_address || null;
    }

    async getOrderBillingAddress(orderId) {
        const order = await this.getOrder(orderId);
        return order?.billing_address || null;
    }

    async getOrderItems(orderId) {
        const order = await this.getOrder(orderId);
        return order?.products || [];
    }

    async getOrderCustomer(orderId) {
        const order = await this.getOrder(orderId);
        return order?.customer || null;
    }

    async getOrderShippingMethod(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_option || null;
    }

    async getOrderShippingCost(orderId) {
        const order = await this.getOrder(orderId);
        return order?.shipping_cost || 0;
    }

    async getOrderSubtotal(orderId) {
        const order = await this.getOrder(orderId);
        return order?.subtotal || 0;
    }

    /**
     * Busca pedido por código de rastreamento
     * @param {string} trackingNumber - Código de rastreamento
     * @returns {Promise<Object|null>} Pedido encontrado ou null
     */
    async getOrderByTrackingNumber(trackingNumber) {
        try {
            const { data: orders } = await this.getOrders({
                shipping_tracking_number: trackingNumber
            });

            if (!orders || orders.length === 0) {
                logger.warn('PedidoNaoEncontradoPorRastreio', {
                    rastreio: trackingNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Retorna o pedido mais recente se houver múltiplos
            const order = orders[0];
            logger.info('PedidoEncontradoPorRastreio', {
                trackingNumber,
                orderId: order.id,
                status: order.status,
                timestamp: new Date().toISOString()
            });

            return order;
        } catch (error) {
            logger.error('ErroBuscarPedidoPorRastreio', {
                rastreio: trackingNumber,
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Sincroniza pedidos recentes
     * @param {Object} options - Opções de sincronização
     * @param {Date} options.since - Data inicial para sincronização
     * @returns {Promise<Array>} Lista de pedidos sincronizados
     */
    async syncOrders(options = {}) {
        try {
            logger.info('SyncOrders', {
                options,
                timestamp: new Date().toISOString()
            });

            const since = options.since || new Date(Date.now() - 24 * 60 * 60 * 1000); // Últimas 24h por padrão
            
            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params: {
                    created_at_min: since.toISOString(),
                    per_page: 50,
                    fields: 'id,number,status,payment_status,shipping_status,shipping_tracking_number'
                }
            });

            const orders = response.data;
            
            // Atualiza cache se disponível
            if (this.cache) {
                for (const order of orders) {
                    const cacheKey = this.cache.generateCacheKey('order', order.id);
                    await this.cacheService.set(cacheKey, JSON.stringify(order), NUVEMSHOP_CONFIG.cache.ttl.orders.recent);
                }
            }

            logger.info('OrdersSynced', {
                count: orders.length,
                timestamp: new Date().toISOString()
            });

            return orders;

        } catch (error) {
            logger.error('ErrorSyncOrders', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }
}

module.exports = { OrderService };
