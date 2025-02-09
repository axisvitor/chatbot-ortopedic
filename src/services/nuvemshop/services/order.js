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
     * Busca pedidos com filtros
     * @param {Object} params - Parâmetros de busca
     * @returns {Promise<Array>} Lista de pedidos
     */
    async getOrders(params = {}, retryCount = 0) {
        try {
            // Validação de parâmetros
            if (params.created_at_min) {
                const minDate = new Date(params.created_at_min);
                if (isNaN(minDate.getTime())) {
                    throw new Error('Data inicial inválida');
                }
            }

            // Se não houver data inicial, usa últimas 24h
            if (!params.created_at_min) {
                const now = new Date();
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                params.created_at_min = yesterday.toISOString();
            }

            // Garante que o status esteja no formato correto
            if (params.status && !Array.isArray(params.status)) {
                params.status = [params.status];
            }

            // Mapeia os status para os valores aceitos pela API
            const statusMapping = {
                'pending': 'open',
                'paid': 'paid',
                'authorized': 'authorized'
            };

            if (params.status) {
                params.status = params.status.map(s => statusMapping[s] || s);
            }

            // Log da requisição
            logger.debug('BuscandoPedidos', {
                parametros: params,
                tentativa: retryCount + 1,
                timestamp: new Date().toISOString()
            });

            // Configura os headers corretos
            const headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authentication': `bearer ${NUVEMSHOP_CONFIG.accessToken}`,
                'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)'
            };

            const response = await this.client.get(`/${NUVEMSHOP_CONFIG.userId}/orders`, {
                params,
                headers,
                timeout: 60000 // 60s timeout
            });

            // Log de sucesso
            logger.info('PedidosEncontrados', {
                quantidade: Array.isArray(response.data) ? response.data.length : 0,
                parametros: params,
                timestamp: new Date().toISOString()
            });

            return response.data;
        } catch (error) {
            // Extrai informações relevantes do erro
            const errorInfo = {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
                params: params,
                tentativa: retryCount + 1,
                timestamp: new Date().toISOString()
            };

            // Máximo de 3 tentativas
            const MAX_RETRIES = 3;

            // Trata erros específicos
            if (error.response?.status === 500 && retryCount < MAX_RETRIES) {
                logger.warn('RetentativaNuvemshop', {
                    ...errorInfo,
                    proximaTentativa: retryCount + 1,
                    esperaSegundos: 5
                });

                // Espera 5 segundos e tenta novamente
                await new Promise(resolve => setTimeout(resolve, 5000));
                return this.getOrders(params, retryCount + 1);
            } 
            else if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
                const resetTime = error.response.headers['x-rate-limit-reset'];
                const waitTime = Math.min(
                    (new Date(resetTime) - new Date()) + 1000, // +1s de margem
                    30000 // máximo 30s de espera
                );

                logger.warn('LimiteRequisicoes', {
                    ...errorInfo,
                    limite: error.response.headers['x-rate-limit-limit'],
                    restante: error.response.headers['x-rate-limit-remaining'],
                    reset: error.response.headers['x-rate-limit-reset'],
                    esperaMs: waitTime
                });

                // Espera até o reset e tenta novamente
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this.getOrders(params, retryCount + 1);
            }
            else if (!error.response && retryCount < MAX_RETRIES) {
                logger.error('ErroConexaoNuvemshop', {
                    ...errorInfo,
                    code: error.code,
                    sugestao: 'Verificar conectividade com a API'
                });

                // Espera 3 segundos e tenta novamente
                await new Promise(resolve => setTimeout(resolve, 3000));
                return this.getOrders(params, retryCount + 1);
            }
            else {
                // Log do erro após todas as tentativas
                if (error.response?.status === 500) {
                    logger.error('ErroInternoNuvemshop', {
                        ...errorInfo,
                        sugestao: 'Verificar status da API da Nuvemshop'
                    });
                } else {
                    logger.error('ErroBuscarPedidos', errorInfo);
                }

                // Trata o erro de forma mais amigável
                const enhancedError = new Error(`Erro ao buscar pedidos: ${error.message}`);
                enhancedError.originalError = error;
                enhancedError.status = error.response?.status;
                enhancedError.data = error.response?.data;
                enhancedError.params = params;
                enhancedError.retryCount = retryCount;

                throw enhancedError;
            }
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
