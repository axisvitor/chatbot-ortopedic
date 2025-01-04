const { OrderApi } = require('./nuvemshop/api/order');
const { RedisStore } = require('../store/redis-store');
const { TrackingService } = require('./tracking-service');
const { formatTimeAgo } = require('../utils/date-utils');
const { NUVEMSHOP_CONFIG } = require('../config/settings');
const { NuvemshopService } = require('./nuvemshop-service');
const { ImageProcessingService } = require('./image-processing-service');
const { FinancialService } = require('./financial-service');
const moment = require('moment');

class OrderValidationService {
    constructor(nuvemshopClient = null, whatsAppService = null) {
        this.nuvemshopService = new NuvemshopService();
        this.orderApi = new OrderApi(nuvemshopClient || this.nuvemshopService.client);
        this.redisStore = new RedisStore();
        this.imageProcessor = new ImageProcessingService();
        this.MAX_ATTEMPTS = 5; // Limite de tentativas por usuário
        this.BLOCK_TIME = 1800; // 30 minutos em segundos
        this.CACHE_TTL = NUVEMSHOP_CONFIG.cache.ttl.orders.recent; // 5 minutos para pedidos recentes

        // Configura WhatsApp e Tracking
        this.whatsAppService = whatsAppService;
        this.trackingService = whatsAppService ? new TrackingService(whatsAppService) : null;
        this.financialService = new FinancialService(whatsAppService);
    }

    /**
     * Obtém o serviço WhatsApp
     * @private
     */
    get _whatsAppService() {
        return this.whatsAppService;
    }

    /**
     * Obtém o serviço de rastreamento
     * @private
     */
    get _trackingService() {
        return this.trackingService;
    }

    /**
     * Obtém o serviço financeiro
     * @private
     */
    get _financialService() {
        return this.financialService;
    }

    /**
     * Verifica tentativas de validação do usuário
     * @param {string} phoneNumber - Número do WhatsApp
     * @returns {Promise<boolean>} - Se o usuário está bloqueado
     */
    async checkAttempts(phoneNumber) {
        const key = `validation_attempts:${phoneNumber}`;
        const attempts = await this.redisStore.get(key) || 0;
        
        if (attempts >= this.MAX_ATTEMPTS) {
            return true;
        }
        return false;
    }

    /**
     * Incrementa tentativas de validação
     * @param {string} phoneNumber - Número do WhatsApp
     */
    async incrementAttempts(phoneNumber) {
        const key = `validation_attempts:${phoneNumber}`;
        const attempts = await this.redisStore.get(key) || 0;
        await this.redisStore.set(key, attempts + 1, this.BLOCK_TIME);
    }

    /**
     * Reseta tentativas de validação
     * @param {string} phoneNumber - Número do WhatsApp
     */
    async resetAttempts(phoneNumber) {
        const key = `validation_attempts:${phoneNumber}`;
        await this.redisStore.del(key);
    }

    /**
     * Verifica se o texto é um número de pedido válido
     * @param {string} text - Texto a ser verificado
     * @returns {boolean} True se for número de pedido válido
     */
    isValidOrderNumber(text) {
        if (!text) return false;
        
        // Remove caracteres especiais e espaços
        const cleanText = text.replace(/[^0-9]/g, '');
        
        // Verifica se é um número com 4 ou mais dígitos
        return /^\d{4,}$/.test(cleanText);
    }

    /**
     * Extrai e valida número do pedido
     * @param {string|Buffer} input Texto ou buffer de imagem
     * @returns {Promise<{orderNumber: string|null, isImage: boolean}>} Número do pedido validado e se veio de imagem
     */
    async extractOrderNumber(input) {
        try {
            let orderNumber = null;
            let isImage = false;

            // Se for URL ou buffer de imagem
            if (typeof input === 'string' && (input.startsWith('http') || input.startsWith('data:'))) {
                isImage = true;
                orderNumber = await this.imageProcessor.extractOrderNumber(input);
            } 
            // Se for texto
            else if (typeof input === 'string') {
                // Remove caracteres especiais e espaços
                orderNumber = input.replace(/[^0-9]/g, '');
                
                // Verifica se é um número com 4 ou mais dígitos
                if (!this.isValidOrderNumber(orderNumber)) {
                    orderNumber = null;
                }
            }

            if (!orderNumber) {
                console.log('[OrderValidation] Número do pedido não encontrado no input:', {
                    input: typeof input === 'string' ? input.substring(0, 100) : 'Buffer',
                    isImage
                });
                return { orderNumber: null, isImage };
            }

            // Verifica se o pedido existe
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                console.log('[OrderValidation] Pedido não encontrado:', orderNumber);
                return { orderNumber: null, isImage };
            }

            return { orderNumber, isImage };

        } catch (error) {
            console.error('[OrderValidation] Erro ao extrair número do pedido:', error);
            return { orderNumber: null, isImage: false };
        }
    }

    /**
     * Processa comprovante de pagamento
     * @param {string} imageUrl URL da imagem do comprovante
     * @param {string} phoneNumber Número do WhatsApp do cliente
     * @returns {Promise<{success: boolean, message: string, askForOrder: boolean}>} Resultado do processamento
     */
    async processPaymentProof(imageUrl, phoneNumber) {
        try {
            // Verifica tentativas
            if (await this.checkAttempts(phoneNumber)) {
                return {
                    success: false,
                    askForOrder: false,
                    message: 'Você excedeu o limite de tentativas. Por favor, aguarde alguns minutos.'
                };
            }

            // Extrai número do pedido
            const { orderNumber, isImage } = await this.extractOrderNumber(imageUrl);
            
            // Se não encontrou o número do pedido, mas é uma imagem que parece ser um comprovante
            const isPaymentProof = await this.imageProcessor.isPaymentProof(imageUrl);
            if (!orderNumber && isPaymentProof) {
                // Salva a imagem temporariamente
                const key = `pending_proof:${phoneNumber}`;
                await this.redisStore.set(key, imageUrl, 3600); // expira em 1 hora
                
                return {
                    success: true,
                    askForOrder: true,
                    message: 'Recebi seu comprovante! Por favor, me informe o número do pedido para que eu possa encaminhar ao setor financeiro.'
                };
            }

            // Se não é um comprovante
            if (!orderNumber && !isPaymentProof) {
                await this.incrementAttempts(phoneNumber);
                return {
                    success: false,
                    askForOrder: false,
                    message: 'Não foi possível identificar um comprovante de pagamento válido na imagem.'
                };
            }

            // Se tem número do pedido, processa normalmente
            if (orderNumber) {
                // Busca pedido
                const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
                
                // Valida status do pedido
                if (order.payment_status === 'paid') {
                    return {
                        success: false,
                        askForOrder: false,
                        message: `O pedido #${orderNumber} já está marcado como pago.`
                    };
                }

                if (order.status === 'closed' || order.status === 'cancelled') {
                    return {
                        success: false,
                        askForOrder: false,
                        message: `O pedido #${orderNumber} já está ${order.status === 'closed' ? 'fechado' : 'cancelado'}.`
                    };
                }

                // Encaminha para o financeiro
                const financial = this._financialService;
                await financial.forwardCase({
                    order_number: orderNumber,
                    reason: 'payment_proof',
                    customer_message: 'Cliente enviou comprovante de pagamento',
                    priority: 'medium',
                    additional_info: `Comprovante enviado via WhatsApp\nURL: ${imageUrl}`
                });

                // Reseta tentativas se chegou até aqui
                await this.resetAttempts(phoneNumber);

                return {
                    success: true,
                    askForOrder: false,
                    message: `Comprovante recebido para o pedido #${orderNumber}. ` +
                            'Nossa equipe irá analisar e confirmar o pagamento em breve.'
                };
            }

        } catch (error) {
            console.error('[OrderValidation] Erro ao processar comprovante:', error);
            return {
                success: false,
                askForOrder: false,
                message: 'Ocorreu um erro ao processar o comprovante. Por favor, tente novamente.'
            };
        }
    }

    /**
     * Processa número do pedido para comprovante pendente
     * @param {string} orderNumber Número do pedido
     * @param {string} phoneNumber Número do WhatsApp do cliente
     * @returns {Promise<{success: boolean, message: string}>} Resultado do processamento
     */
    async processPendingProof(orderNumber, phoneNumber) {
        try {
            // Busca comprovante pendente
            const key = `pending_proof:${phoneNumber}`;
            const imageUrl = await this.redisStore.get(key);
            
            if (!imageUrl) {
                return {
                    success: false,
                    message: 'Não encontrei nenhum comprovante pendente. Por favor, envie o comprovante novamente.'
                };
            }

            // Remove o comprovante pendente
            await this.redisStore.del(key);

            // Busca pedido
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                return {
                    success: false,
                    message: 'Pedido não encontrado. Por favor, verifique o número e tente novamente.'
                };
            }

            // Valida status do pedido
            if (order.payment_status === 'paid') {
                return {
                    success: false,
                    message: `O pedido #${orderNumber} já está marcado como pago.`
                };
            }

            if (order.status === 'closed' || order.status === 'cancelled') {
                return {
                    success: false,
                    message: `O pedido #${orderNumber} já está ${order.status === 'closed' ? 'fechado' : 'cancelado'}.`
                };
            }

            // Encaminha para o financeiro
            const financial = this._financialService;
            await financial.forwardCase({
                order_number: orderNumber,
                reason: 'payment_proof',
                customer_message: 'Cliente enviou comprovante de pagamento',
                priority: 'medium',
                additional_info: `Comprovante enviado via WhatsApp\nURL: ${imageUrl}`
            });

            return {
                success: true,
                message: `Comprovante vinculado ao pedido #${orderNumber}. ` +
                        'Nossa equipe irá analisar e confirmar o pagamento em breve.'
            };

        } catch (error) {
            console.error('[OrderValidation] Erro ao processar pedido pendente:', error);
            return {
                success: false,
                message: 'Ocorreu um erro ao processar o pedido. Por favor, tente novamente.'
            };
        }
    }

    /**
     * Busca informações do pedido
     * @param {string} input Texto ou URL da imagem contendo número do pedido
     * @returns {Promise<Object|null>} Informações do pedido ou null se não encontrado
     */
    async findOrder(input) {
        try {
            const { orderNumber } = await this.extractOrderNumber(input);
            if (!orderNumber) {
                return null;
            }

            return await this.nuvemshopService.findOrder(orderNumber);
        } catch (error) {
            console.error('[OrderValidation] Erro ao buscar pedido:', error);
            return null;
        }
    }

    /**
     * Valida número do pedido
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async validateOrderNumber(orderNumber) {
        try {
            // Remove caracteres especiais e espaços
            const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
            
            // Valida o formato do número
            if (!this.isValidOrderNumber(cleanNumber)) {
                console.log('❌ Número de pedido inválido:', {
                    numero: cleanNumber,
                    numeroOriginal: orderNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }
            
            console.log('🔍 Validando pedido:', {
                numero: cleanNumber,
                numeroOriginal: orderNumber,
                timestamp: new Date().toISOString()
            });

            // Busca o pedido
            const order = await this.orderApi.getOrderByNumber(cleanNumber);
            
            if (!order) {
                console.log('❌ Pedido não encontrado:', {
                    numero: cleanNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Se tem código de rastreio, busca informações atualizadas
            let trackingDetails = null;
            if (order.shipping_tracking_number) {
                try {
                    console.log('🔍 Buscando rastreamento:', {
                        codigo: order.shipping_tracking_number,
                        timestamp: new Date().toISOString()
                    });
                    
                    trackingDetails = await this._trackingService.getTrackingInfo(order.shipping_tracking_number);
                    
                    if (trackingDetails?.success) {
                        console.log('✅ Rastreamento encontrado:', {
                            codigo: order.shipping_tracking_number,
                            status: trackingDetails.status,
                            ultima_atualizacao: trackingDetails.lastEvent?.time,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    console.error('⚠️ Erro ao buscar rastreamento:', {
                        codigo: order.shipping_tracking_number,
                        erro: error.message,
                        timestamp: new Date().toISOString()
                    });
                    // Não falha se o rastreamento der erro
                }
            }

            // Formata as informações com os detalhes de rastreamento
            return this.formatSafeOrderInfo(order, trackingDetails);
        } catch (error) {
            console.error('❌ Erro ao validar pedido:', {
                erro: error.message,
                numero: orderNumber,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Formata informações seguras do pedido
     * @param {Object} order - Pedido completo
     * @param {Object} trackingDetails - Detalhes do rastreamento
     * @returns {Object} Informações seguras do pedido
     */
    formatSafeOrderInfo(order, trackingDetails = null) {
        try {
            // Garantir que temos os dados mínimos
            if (!order || !order.number) {
                throw new Error('Dados do pedido incompletos');
            }

            // Tradução de status
            const statusMap = {
                'open': 'Aberto',
                'closed': 'Fechado',
                'cancelled': 'Cancelado',
                'shipped': 'Enviado',
                'pending': 'Pendente',
                'paid': 'Pago',
                'voided': 'Cancelado'
            };

            // Formata status de envio
            let shippingStatus = 'Não disponível';
            if (order.shipping_status) {
                shippingStatus = statusMap[order.shipping_status.toLowerCase()] || order.shipping_status;
            } else if (order.fulfillments && order.fulfillments.length > 0) {
                const lastFulfillment = order.fulfillments[order.fulfillments.length - 1];
                if (lastFulfillment.status) {
                    shippingStatus = statusMap[lastFulfillment.status.toLowerCase()] || lastFulfillment.status;
                }
            }

            // Formata status de pagamento
            const paymentStatus = statusMap[order.payment_status] || 'Não disponível';

            // Formata data
            const orderDate = order.created_at 
                ? new Date(order.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Não disponível';

            // Formata valor total
            const orderTotal = order.total 
                ? new Intl.NumberFormat('pt-BR', { 
                    style: 'currency', 
                    currency: order.currency || 'BRL' 
                  }).format(order.total)
                : 'Não disponível';

            // Formata produtos
            const products = Array.isArray(order.products) 
                ? order.products.map(product => ({
                    nome: product.name,
                    quantidade: product.quantity,
                    preco: new Intl.NumberFormat('pt-BR', { 
                        style: 'currency', 
                        currency: order.currency || 'BRL' 
                    }).format(product.price)
                  }))
                : [];

            // Formata rastreamento com detalhes do 17Track
            const tracking = {
                codigo: order.shipping_tracking_number || 'Não disponível',
                status: 'Não disponível',
                ultima_atualizacao: null,
                detalhes: null
            };

            // Se tiver detalhes do 17Track, adiciona as informações
            if (trackingDetails?.success) {
                tracking.status = trackingDetails.status || tracking.status;
                tracking.ultima_atualizacao = trackingDetails.lastEvent?.time || null;
                tracking.detalhes = trackingDetails.lastEvent?.description || null;
            }

            return {
                numero_pedido: order.number,
                cliente: order.customer?.name || 'Não disponível',
                data: orderDate,
                status: statusMap[order.status] || order.status,
                valor_total: orderTotal,
                produtos: products,
                status_envio: shippingStatus,
                rastreamento: tracking
            };

        } catch (error) {
            console.error('❌ Erro ao formatar pedido:', {
                erro: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    /**
     * Formata mensagem de rastreamento
     * @param {string} trackingNumber - Código de rastreio
     * @returns {string} Mensagem formatada
     */
    formatTrackingMessage(trackingNumber) {
        if (!trackingNumber) return null;

        return `🚚 *Rastreamento do Pedido*\n\n` +
            `📦 Código de Rastreio: ${trackingNumber}\n\n` +
            `🔍 Acompanhe seu pedido em:\n` +
            `https://t.17track.net/pt-br#nums=${trackingNumber}\n\n` +
            `_Clique no link acima para ver o status atualizado da entrega_`;
    }

    /**
     * Formata mensagem de pedido para WhatsApp
     * @param {Object} orderInfo - Informações seguras do pedido
     * @param {string} userPhone - Telefone do usuário
     * @returns {string} Mensagem formatada
     */
    async formatOrderMessage(orderInfo, userPhone = null) {
        try {
            // Log das informações que serão formatadas
            console.log('📋 Formatando mensagem:', {
                numero: orderInfo.numero_pedido,
                cliente: orderInfo.cliente,
                status: orderInfo.status,
                rastreio: orderInfo.rastreamento?.codigo,
                produtos: orderInfo.produtos?.length,
                timestamp: new Date().toISOString()
            });

            // Formata a data corretamente
            const orderDate = orderInfo.data ? 
                moment(orderInfo.data).format('DD/MM/YYYY HH:mm') : 
                'Data não disponível';

            // Formata o valor total com segurança
            const totalValue = typeof orderInfo.valor_total === 'number' ? 
                orderInfo.valor_total.toFixed(2) : 
                String(orderInfo.valor_total || '0.00').replace(/[^\d.,]/g, '');

            // Template base do pedido conforme prompt
            let message = `🛍 Detalhes do Pedido #${orderInfo.numero_pedido}\n\n`;
            message += `👤 Cliente: ${orderInfo.cliente}\n`;
            message += `📅 Data: ${orderDate}\n`;
            message += `📦 Status: ${orderInfo.status}\n`;
            message += `💰 Valor Total: R$ ${totalValue}\n`;
            
            // Adiciona informações de pagamento
            if (orderInfo.pagamento) {
                message += `💳 Pagamento: ${orderInfo.pagamento.metodo}\n`;
                message += `📊 Status Pagamento: ${orderInfo.pagamento.status}\n`;
            }
            
            message += '\n';
            
            // Lista de produtos com formato do prompt
            if (Array.isArray(orderInfo.produtos) && orderInfo.produtos.length > 0) {
                message += `*Produtos:*\n`;
                orderInfo.produtos.forEach(produto => {
                    // Formata o preço com segurança
                    const price = typeof produto.preco === 'number' ? 
                        produto.preco.toFixed(2) : 
                        String(produto.preco || '0.00').replace(/[^\d.,]/g, '');
                    
                    // Inclui variações se existirem
                    const variacoes = produto.variacoes ? ` (${produto.variacoes})` : '';
                    message += `▫ ${produto.quantidade}x ${produto.nome}${variacoes} - R$ ${price}\n`;
                });
            }

            // Apenas inclui informações básicas de rastreio se disponível
            if (orderInfo.rastreamento?.codigo && orderInfo.rastreamento.codigo !== 'Não disponível') {
                message += `\n📦 *Status do Rastreamento*\n\n`;
                message += `*Código:* ${orderInfo.rastreamento.codigo}\n`;
                
                // Determina o emoji do status
                let statusEmoji = '📦'; // Padrão: Em Processamento
                if (orderInfo.status_envio) {
                    const status = orderInfo.status_envio.toLowerCase();
                    if (status.includes('trânsito')) statusEmoji = '📫';
                    else if (status.includes('entregue')) statusEmoji = '✅';
                    else if (status.includes('coletado') || status.includes('postado')) statusEmoji = '🚚';
                    else if (status.includes('tributação') || status.includes('taxa')) statusEmoji = '💰';
                }
                
                message += `*Status:* ${statusEmoji} ${orderInfo.status_envio || 'Em processamento'}\n`;
                
                if (orderInfo.rastreamento.ultima_atualizacao) {
                    message += `*Última Atualização:* ${moment(orderInfo.rastreamento.ultima_atualizacao).format('DD/MM/YYYY HH:mm')}\n`;
                }

                // Adiciona as últimas 3 atualizações se disponíveis
                if (Array.isArray(orderInfo.rastreamento.eventos) && orderInfo.rastreamento.eventos.length > 0) {
                    message += `\n📝 *Últimas Atualizações:*\n`;
                    
                    // Pega os 3 eventos mais recentes
                    const lastEvents = orderInfo.rastreamento.eventos.slice(0, 3);
                    lastEvents.forEach((evento, index) => {
                        const eventDate = moment(evento.data).format('DD/MM/YYYY HH:mm');
                        message += `${index + 1}. ${eventDate}\n   ${evento.descricao}\n`;
                    });

                    // Adiciona tempo em trânsito se disponível
                    if (orderInfo.rastreamento.dias_transito) {
                        message += `\n_Tempo em trânsito: ${orderInfo.rastreamento.dias_transito} dias_`;
                    }
                } else {
                    message += `\n_Use a função check_tracking para ver o status atualizado da entrega_`;
                }
            }

            return message;

        } catch (error) {
            console.error('❌ Erro ao formatar mensagem do pedido:', error);
            return 'Desculpe, ocorreu um erro ao formatar as informações do pedido. Por favor, tente novamente em alguns instantes.';
        }
    }

    /**
     * Busca informações do pedido
     * @param {string} input Texto ou URL da imagem contendo número do pedido
     * @returns {Promise<Object|null>} Informações do pedido ou null se não encontrado
     */
    async findOrder(input) {
        try {
            const { orderNumber } = await this.extractOrderNumber(input);
            if (!orderNumber) {
                return null;
            }

            return await this.nuvemshopService.findOrder(orderNumber);
        } catch (error) {
            console.error('[OrderValidation] Erro ao buscar pedido:', error);
            return null;
        }
    }

    /**
     * Valida número do pedido
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async validateOrderNumber(orderNumber) {
        try {
            // Remove caracteres especiais e espaços
            const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
            
            // Valida o formato do número
            if (!this.isValidOrderNumber(cleanNumber)) {
                console.log('❌ Número de pedido inválido:', {
                    numero: cleanNumber,
                    numeroOriginal: orderNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }
            
            console.log('🔍 Validando pedido:', {
                numero: cleanNumber,
                numeroOriginal: orderNumber,
                timestamp: new Date().toISOString()
            });

            // Busca o pedido
            const order = await this.orderApi.getOrderByNumber(cleanNumber);
            
            if (!order) {
                console.log('❌ Pedido não encontrado:', {
                    numero: cleanNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Se tem código de rastreio, busca informações atualizadas
            let trackingDetails = null;
            if (order.shipping_tracking_number) {
                try {
                    console.log('🔍 Buscando rastreamento:', {
                        codigo: order.shipping_tracking_number,
                        timestamp: new Date().toISOString()
                    });
                    
                    trackingDetails = await this._trackingService.getTrackingInfo(order.shipping_tracking_number);
                    
                    if (trackingDetails?.success) {
                        console.log('✅ Rastreamento encontrado:', {
                            codigo: order.shipping_tracking_number,
                            status: trackingDetails.status,
                            ultima_atualizacao: trackingDetails.lastEvent?.time,
                            timestamp: new Date().toISOString()
                        });
                    }
                } catch (error) {
                    console.error('⚠️ Erro ao buscar rastreamento:', {
                        codigo: order.shipping_tracking_number,
                        erro: error.message,
                        timestamp: new Date().toISOString()
                    });
                    // Não falha se o rastreamento der erro
                }
            }

            // Formata as informações com os detalhes de rastreamento
            return this.formatSafeOrderInfo(order, trackingDetails);
        } catch (error) {
            console.error('❌ Erro ao validar pedido:', {
                erro: error.message,
                numero: orderNumber,
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Formata mensagem de rastreamento
     * @param {string} trackingNumber - Código de rastreio
     * @returns {string} Mensagem formatada
     */
    formatTrackingMessage(trackingNumber) {
        if (!trackingNumber) return null;

        return `🚚 *Rastreamento do Pedido*\n\n` +
            `📦 Código de Rastreio: ${trackingNumber}\n\n` +
            `🔍 Acompanhe seu pedido em:\n` +
            `https://t.17track.net/pt-br#nums=${trackingNumber}\n\n` +
            `_Clique no link acima para ver o status atualizado da entrega_`;
    }

    /**
     * Busca e formata status de rastreamento
     * @param {string} trackingNumber - Código de rastreio
     * @returns {Promise<string>} Mensagem formatada com status atual
     */
    async getTrackingStatus(trackingNumber) {
        return this._trackingService.getTrackingStatus(trackingNumber);
    }

    formatOrderTrackingResponse(trackingInfo) {
        if (!trackingInfo) return null;

        // Remove ponto e vírgula extra da URL se existir
        if (trackingInfo.url) {
            trackingInfo.url = trackingInfo.url.replace(/;$/, '');
        }

        return `🚚 *Status do Rastreamento*\n\n` +
            `📦 Código: ${trackingInfo.code}\n` +
            `📍 Status: ${trackingInfo.status}\n` +
            `Última atualização: ${formatTimeAgo(trackingInfo.time)}`;
    }

    async validatePaymentProof(orderNumber, imageBuffer) {
        try {
            console.log('🔍 Iniciando validação de comprovante:', {
                pedido: orderNumber,
                timestamp: new Date().toISOString()
            });

            // 1. Busca o pedido na Nuvemshop
            const order = await this.orderApi.getOrderByNumber(orderNumber);
            if (!order) {
                throw new Error(`Pedido #${orderNumber} não encontrado`);
            }

            // 2. Analisa o comprovante com Groq
            const imageService = new WhatsAppImageService();
            const proofAnalysis = await imageService.processPaymentProof(imageBuffer, orderNumber);

            // 3. Valida as informações
            const validation = this.validatePaymentInfo(order, proofAnalysis.analysis);

            // 4. Se validação ok, notifica o financeiro
            if (validation.isValid) {
                await this.notifyFinancialDepartment(order, proofAnalysis);
            }

            return validation;

        } catch (error) {
            console.error('❌ Erro na validação do comprovante:', {
                erro: error.message,
                pedido: orderNumber,
                timestamp: new Date().toISOString()
            });
            throw error;
        }
    }

    validatePaymentInfo(order, proofAnalysis) {
        const validation = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Extrai valor do pedido
        const orderAmount = parseFloat(order.total);

        // Extrai valor do comprovante usando regex
        const amountMatch = proofAnalysis.match(/R\$\s*(\d+(?:\.\d{2})?)/);
        const proofAmount = amountMatch ? parseFloat(amountMatch[1]) : null;

        // 1. Valida valor
        if (!proofAmount) {
            validation.errors.push('Não foi possível identificar o valor no comprovante');
            validation.isValid = false;
        } else if (proofAmount < orderAmount) {
            validation.errors.push(`Valor do comprovante (R$ ${proofAmount}) é menor que o valor do pedido (R$ ${orderAmount})`);
            validation.isValid = false;
        } else if (proofAmount > orderAmount) {
            validation.warnings.push(`Valor do comprovante (R$ ${proofAmount}) é maior que o valor do pedido (R$ ${orderAmount})`);
        }

        // 2. Valida data
        const dateMatch = proofAnalysis.match(/\d{2}\/\d{2}\/\d{4}/);
        if (!dateMatch) {
            validation.warnings.push('Não foi possível identificar a data no comprovante');
        } else {
            const proofDate = new Date(dateMatch[0].split('/').reverse().join('-'));
            const orderDate = new Date(order.created_at);
            
            // Se comprovante é de antes do pedido
            if (proofDate < orderDate) {
                validation.errors.push('Comprovante é anterior à data do pedido');
                validation.isValid = false;
            }
            
            // Se comprovante é muito antigo (mais de 24h)
            const hoursDiff = Math.abs(proofDate - orderDate) / 36e5;
            if (hoursDiff > 24) {
                validation.warnings.push('Comprovante tem mais de 24 horas de diferença do pedido');
            }
        }

        // 3. Valida tipo de transação
        if (!proofAnalysis.match(/pix|ted|doc|transferência|depósito/i)) {
            validation.warnings.push('Tipo de transação não identificado claramente no comprovante');
        }

        // 4. Valida status
        if (!proofAnalysis.match(/concluíd|aprovad|efetivad|realizada|confirmad/i)) {
            validation.errors.push('Não foi possível confirmar que a transação foi concluída');
            validation.isValid = false;
        }

        return validation;
    }

    async notifyFinancialDepartment(order, proofAnalysis) {
        const message = `💰 *Novo Comprovante de Pagamento*\n\n` +
                       `📦 Pedido: #${order.number}\n` +
                       `👤 Cliente: ${order.customer.name}\n` +
                       `💵 Valor do Pedido: R$ ${order.total}\n\n` +
                       `*Análise do Comprovante:*\n${proofAnalysis.analysis}\n\n` +
                       `✅ Comprovante validado automaticamente`;

        const whatsapp = this.whatsAppService;
        await whatsapp.forwardToFinancial({ body: message }, order.number);
    }

    /**
     * Busca pedido de forma inteligente usando diferentes estratégias
     * @param {string} input - Texto do usuário
     * @param {string} phone - Telefone do usuário
     * @returns {Promise<Object>} Pedido encontrado ou null
     */
    async findOrderSmart(input, phone) {
        console.log('🔍 Iniciando busca inteligente de pedido:', { input, phone });

        // 1. Tenta extrair número do pedido direto
        let orderNumber = this.extractOrderNumber(input);
        if (orderNumber) {
            console.log('✨ Número de pedido encontrado no texto:', orderNumber);
            const order = await this.validateOrderNumber(orderNumber);
            if (order) return order;
        }

        // 2. Busca pedidos recentes do usuário
        const recentOrders = await this.nuvemshopService.getRecentOrdersByPhone(phone);
        if (recentOrders?.length) {
            console.log('📦 Encontrados pedidos recentes:', recentOrders.length);

            // 2.1 Procura por pedidos pendentes
            const pendingOrder = recentOrders.find(order => 
                order.payment_status === 'pending' || 
                order.status === 'open'
            );
            if (pendingOrder) {
                console.log('💡 Encontrado pedido pendente:', pendingOrder.number);
                return pendingOrder;
            }

            // 2.2 Procura por pedidos em processamento
            const processingOrder = recentOrders.find(order => 
                order.status === 'processing' || 
                order.status === 'shipped'
            );
            if (processingOrder) {
                console.log('📬 Encontrado pedido em processamento:', processingOrder.number);
                return processingOrder;
            }

            // 2.3 Retorna o pedido mais recente
            console.log('🕒 Retornando pedido mais recente:', recentOrders[0].number);
            return recentOrders[0];
        }

        // 3. Tenta extrair número do pedido de forma mais flexível
        const matches = input.match(/\d{5,7}/g);
        if (matches) {
            for (const match of matches) {
                console.log('🔄 Tentando validar possível número:', match);
                const order = await this.validateOrderNumber(match);
                if (order) {
                    console.log('✅ Pedido encontrado com número alternativo:', order.number);
                    return order;
                }
            }
        }

        console.log('❌ Nenhum pedido encontrado');
        return null;
    }

    /**
     * Formata mensagem de pedido não encontrado
     * @param {string} input - Texto original do usuário
     * @returns {string} Mensagem formatada
     */
    formatOrderNotFoundMessage(input) {
        return `❌ Não encontrei nenhum pedido${input ? ` com o número "${input}"` : ''}.\n\n` +
               `Por favor, verifique se o número está correto e tente novamente.\n\n` +
               `💡 Dicas:\n` +
               `- Digite apenas o número do pedido (ex: 12345)\n` +
               `- Verifique no seu email de confirmação\n` +
               `- Se acabou de fazer o pedido, aguarde alguns minutos`;
    }

    /**
     * Processa uma imagem recebida
     * @param {string} imageUrl URL da imagem
     * @param {string} phoneNumber Número do WhatsApp do cliente
     * @returns {Promise<{success: boolean, message: string, askForOrder: boolean, imageInfo: Object}>}
     */
    async processImage(imageUrl, phoneNumber) {
        try {
            // Analisa a imagem
            const imageInfo = await this.imageProcessor.processImage(imageUrl);
            
            // Se for um comprovante de pagamento
            if (imageInfo.isPaymentProof) {
                const result = await this.processPaymentProof(imageUrl, phoneNumber);
                return { ...result, imageInfo };
            }
            
            // Monta mensagem baseada no tipo de imagem
            let message = '';
            switch (imageInfo.type) {
                case 'product_photo':
                    message = 'Recebi sua foto do calçado! ' +
                             'Para melhor atendimento, por favor me informe o número do seu pedido.';
                    break;
                    
                case 'foot_photo':
                    message = 'Recebi sua foto! Para ajudar com a medida do calçado, ' +
                             'por favor me informe o número do seu pedido.';
                    break;
                    
                case 'size_chart':
                    message = 'Recebi sua tabela de medidas! ' +
                             'Por favor, me informe o número do pedido relacionado.';
                    break;
                    
                case 'document':
                    message = 'Recebi seu documento! ' +
                             'Por favor, me informe o número do pedido para que eu possa vincular corretamente.';
                    break;
                    
                default:
                    message = 'Recebi sua imagem! ' +
                             'Para que eu possa ajudar melhor, por favor me informe o número do seu pedido.';
            }

            // Se encontrou um número de pedido na imagem
            if (imageInfo.orderNumber) {
                const order = await this.nuvemshopService.getOrderByNumber(imageInfo.orderNumber);
                if (order) {
                    message += `\n\nIdentifiquei que esta imagem pode estar relacionada ao pedido #${imageInfo.orderNumber}. Isso está correto?`;
                }
            }

            // Salva a imagem temporariamente
            const key = `pending_image:${phoneNumber}`;
            await this.redisStore.set(key, JSON.stringify({
                url: imageUrl,
                type: imageInfo.type,
                description: imageInfo.description
            }), 3600); // expira em 1 hora

            return {
                success: true,
                askForOrder: true,
                message,
                imageInfo
            };

        } catch (error) {
            console.error('[OrderValidation] Erro ao processar imagem:', error);
            return {
                success: false,
                askForOrder: false,
                message: 'Ocorreu um erro ao processar sua imagem. Por favor, tente novamente.',
                imageInfo: null
            };
        }
    }

    /**
     * Processa número do pedido para imagem pendente
     * @param {string} orderNumber Número do pedido
     * @param {string} phoneNumber Número do WhatsApp do cliente
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async processPendingImage(orderNumber, phoneNumber) {
        try {
            // Busca imagem pendente
            const key = `pending_image:${phoneNumber}`;
            const pendingImageStr = await this.redisStore.get(key);
            
            if (!pendingImageStr) {
                return {
                    success: false,
                    message: 'Não encontrei nenhuma imagem pendente. Por favor, envie a imagem novamente.'
                };
            }

            const pendingImage = JSON.parse(pendingImageStr);

            // Remove a imagem pendente
            await this.redisStore.del(key);

            // Busca pedido
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                return {
                    success: false,
                    message: 'Pedido não encontrado. Por favor, verifique o número e tente novamente.'
                };
            }

            // Encaminha para o setor apropriado baseado no tipo de imagem
            let message = '';
            switch (pendingImage.type) {
                case 'product_photo':
                    message = `Foto do calçado vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe de atendimento irá analisar e retornar em breve.';
                    // TODO: Encaminhar para atendimento
                    break;
                    
                case 'foot_photo':
                    message = `Foto vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar as medidas e retornar em breve.';
                    // TODO: Encaminhar para equipe de sizing
                    break;
                    
                case 'size_chart':
                    message = `Tabela de medidas vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar e ajudar com a escolha do tamanho ideal.';
                    // TODO: Encaminhar para equipe de sizing
                    break;
                    
                case 'document':
                    message = `Documento vinculado ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar e retornar em breve.';
                    // TODO: Encaminhar para setor administrativo
                    break;
                    
                default:
                    message = `Imagem vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar e retornar em breve.';
            }

            return {
                success: true,
                message
            };

        } catch (error) {
            console.error('[OrderValidation] Erro ao processar pedido para imagem:', error);
            return {
                success: false,
                message: 'Ocorreu um erro ao processar o pedido. Por favor, tente novamente.'
            };
        }
    }

    /**
     * Valida e processa imagem de pagamento
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object>} Resultado do processamento
     */
    async validatePaymentInfo(orderNumber) {
        try {
            const key = `pending_image:${orderNumber}`;
            const pendingImageStr = await this.redisStore.get(key);
            
            if (!pendingImageStr) {
                return {
                    success: false,
                    message: 'Não encontrei nenhuma imagem pendente. Por favor, envie a imagem novamente.'
                };
            }

            const pendingImage = JSON.parse(pendingImageStr);

            // Remove a imagem pendente
            await this.redisStore.del(key);

            // Busca pedido
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber);
            if (!order) {
                return {
                    success: false,
                    message: 'Pedido não encontrado. Por favor, verifique o número e tente novamente.'
                };
            }

            // Encaminha para o setor apropriado baseado no tipo de imagem
            let message = '';
            switch (pendingImage.type) {
                case 'product_photo':
                    message = `Foto do calçado vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe de atendimento irá analisar e retornar em breve.';
                    // TODO: Encaminhar para atendimento
                    break;
                    
                case 'foot_photo':
                    message = `Foto vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar as medidas e retornar em breve.';
                    // TODO: Encaminhar para equipe de sizing
                    break;
                    
                case 'size_chart':
                    message = `Tabela de medidas vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar e ajudar com a escolha do tamanho ideal.';
                    // TODO: Encaminhar para equipe de sizing
                    break;
                    
                case 'document':
                    message = `Documento vinculado ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar e retornar em breve.';
                    // TODO: Encaminhar para setor administrativo
                    break;
                    
                default:
                    message = `Imagem vinculada ao pedido #${orderNumber}. ` +
                             'Nossa equipe irá analisar e retornar em breve.';
            }

            return {
                success: true,
                message
            };

        } catch (error) {
            console.error('[OrderValidation] Erro ao processar pedido para imagem:', error);
            return {
                success: false,
                message: 'Ocorreu um erro ao processar o pedido. Por favor, tente novamente.'
            };
        }
    }
}

module.exports = { OrderValidationService };