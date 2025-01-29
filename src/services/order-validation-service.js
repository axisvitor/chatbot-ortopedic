const { OrderApi } = require('./nuvemshop/api/order');
const { RedisStore } = require('../store/redis-store');
const { TrackingService } = require('./tracking-service');
const { formatTimeAgo } = require('../utils/date-utils');
const { NUVEMSHOP_CONFIG } = require('../config/settings');
const { NuvemshopService } = require('./nuvemshop');
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
     * Normaliza o número do pedido para um formato padrão
     * @param {string} orderNumber - Número do pedido em qualquer formato
     * @returns {string|null} Número do pedido normalizado ou null se inválido
     */
    normalizeOrderNumber(orderNumber) {
        if (!orderNumber) return null;
        
        // Remove todos os caracteres não numéricos
        const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
        
        // Verifica se é um número com 4 ou mais dígitos
        if (!/^\d{4,}$/.test(cleanNumber)) {
            return null;
        }
        
        // Retorna no formato padrão com #
        return `#${cleanNumber}`;
    }

    /**
     * Verifica se o texto é um número de pedido válido
     * @param {string} text - Texto a ser verificado
     * @returns {boolean} True se for número de pedido válido
     */
    isValidOrderNumber(text) {
        return this.normalizeOrderNumber(text) !== null;
    }

    /**
     * Extrai e valida número do pedido
     * @param {string|Buffer} input Texto ou buffer de imagem
     * @returns {Promise<{orderNumber: string|null, isImage: boolean, error: string|null, details: Object|null}>} Número do pedido validado e se veio de imagem
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
                orderNumber = this.normalizeOrderNumber(input);
            }

            if (!orderNumber) {
                console.log('[OrderValidation] Número do pedido não encontrado no input:', {
                    input: typeof input === 'string' ? input.substring(0, 100) : 'Buffer',
                    isImage
                });
                return { orderNumber: null, isImage, error: null, details: null };
            }

            // Verifica se o pedido existe - remove o # para consulta na Nuvemshop
            const order = await this.nuvemshopService.getOrderByNumber(orderNumber.replace('#', ''));
            
            if (order?.error) {
                console.log('[OrderValidation] Erro ao buscar pedido:', {
                    numero: orderNumber,
                    erro: order.message,
                    detalhes: order.details,
                    timestamp: new Date().toISOString()
                });

                // Se for erro de autenticação, notifica o suporte
                if (order.message === 'Unauthorized') {
                    console.error('[OrderValidation] ⚠️ Erro de autenticação na API da Nuvemshop. Por favor, verifique o token de acesso.');
                }

                return { 
                    orderNumber: null, 
                    isImage,
                    error: order.message,
                    details: order.details 
                };
            }

            if (!order) {
                console.log('[OrderValidation] Pedido não encontrado:', orderNumber);
                return { orderNumber: null, isImage, error: null, details: null };
            }

            return { orderNumber, isImage, error: null, details: null };

        } catch (error) {
            console.error('[OrderValidation] Erro ao extrair número do pedido:', error);
            return { orderNumber: null, isImage: false, error: error.message, details: null };
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
            const { orderNumber, isImage, error, details } = await this.extractOrderNumber(imageUrl);
            
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
            const { orderNumber, isImage, error, details } = await this.extractOrderNumber(input);
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
     * @returns {Promise<string>} Mensagem formatada
     */
    async formatTrackingMessage(trackingNumber) {
        if (!trackingNumber) return null;

        try {
            // Busca o status atual do rastreio
            const trackingStatus = await this._trackingService().getTrackingStatus(trackingNumber);
            
            // Define o emoji baseado no status
            let statusEmoji = '📦';
            let statusMessage = trackingStatus.status;
            let alertMessage = '';

            switch(trackingStatus.status.toLowerCase()) {
                case 'delivered':
                    statusEmoji = '✅';
                    statusMessage = 'Entregue';
                    break;
                case 'intransit':
                    statusEmoji = '🚚';
                    statusMessage = 'Em trânsito';
                    break;
                case 'pickup':
                    statusEmoji = '📬';
                    statusMessage = 'Coletado/Postado';
                    break;
                case 'exception':
                    statusEmoji = '⚠️';
                    statusMessage = 'Problema na entrega';
                    break;
                case 'customshold':
                    statusEmoji = '💰';
                    statusMessage = 'Retido na alfândega';
                    alertMessage = '\n⚠️ *Atenção:* Seu pedido está retido para pagamento de impostos. Aguarde instruções adicionais.';
                    break;
            }

            // Formata a mensagem no mesmo padrão da function check_tracking
            let message = `📦 Status do Rastreamento ${statusEmoji}\n\n` +
                `🔍 Status: ${statusMessage}\n` +
                `📝 Detalhes: ${trackingStatus.sub_status || 'N/A'}\n` +
                `📅 Última Atualização: ${trackingStatus.last_event?.time ? 
                    formatTimeAgo(new Date(trackingStatus.last_event.time)) : 'N/A'}`;

            // Adiciona informações do último evento se disponível
            if (trackingStatus.last_event?.stage) {
                message += `\n📍 Local: ${trackingStatus.last_event.stage}`;
            }

            // Adiciona alerta se houver
            if (alertMessage) {
                message += alertMessage;
            }

            // Adiciona mensagem sobre notificações futuras
            message += '\n\n_Você receberá notificações automáticas sobre atualizações importantes no seu pedido._';

            return message;

        } catch (error) {
            console.error('Erro ao buscar status do rastreio:', error);
            return `📦 Status do Rastreamento\n\n` +
                `❌ Não foi possível obter o status atual.\n` +
                `_Você receberá uma notificação assim que houver atualizações._`;
        }
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
        const result = {
            isValid: false,
            errors: [],
            warnings: [],
            details: {
                value: {
                    expected: order.total,
                    found: proofAnalysis.value,
                    matches: false
                },
                date: {
                    order: null,
                    payment: null,
                    isValid: false
                },
                customer: {
                    matches: false,
                    similarity: 0
                }
            }
        };

        // Valida valor do pagamento
        const tolerance = 0.01; // 1% de tolerância
        const valueDiff = Math.abs(order.total - proofAnalysis.value);
        const valuePercentDiff = valueDiff / order.total;
        
        result.details.value.matches = valuePercentDiff <= tolerance;
        if (!result.details.value.matches) {
            result.errors.push(`Valor do pagamento (${proofAnalysis.value}) não corresponde ao valor do pedido (${order.total})`);
        }

        // Valida data do pagamento
        const orderDate = moment(order.created_at, moment.ISO_8601, true);
        const paymentDate = moment(proofAnalysis.date, [
            'DD/MM/YYYY HH:mm:ss',
            'DD/MM/YYYY HH:mm',
            'DD/MM/YYYY',
            'YYYY-MM-DD HH:mm:ss',
            'YYYY-MM-DD HH:mm',
            'YYYY-MM-DD'
        ], true);

        result.details.date = {
            order: orderDate.isValid() ? orderDate.format('DD/MM/YYYY HH:mm:ss') : null,
            payment: paymentDate.isValid() ? paymentDate.format('DD/MM/YYYY HH:mm:ss') : null,
            isValid: false
        };

        if (!paymentDate.isValid()) {
            result.errors.push('Data do pagamento inválida ou não encontrada');
        } else if (!orderDate.isValid()) {
            result.warnings.push('Não foi possível validar a data do pedido');
        } else {
            // Verifica se pagamento é posterior ao pedido
            const timeDiff = paymentDate.diff(orderDate, 'days');
            
            if (timeDiff < 0) {
                result.errors.push('Data do pagamento é anterior à data do pedido');
            } else if (timeDiff > 30) {
                result.warnings.push('Pagamento realizado mais de 30 dias após o pedido');
            }
            
            result.details.date.isValid = timeDiff >= 0;
        }

        // Valida nome do cliente
        if (order.customer?.name && proofAnalysis.customer) {
            const similarity = this._calculateStringSimilarity(
                order.customer.name.toLowerCase(),
                proofAnalysis.customer.toLowerCase()
            );
            
            result.details.customer = {
                expected: order.customer.name,
                found: proofAnalysis.customer,
                similarity,
                matches: similarity >= 0.8 // 80% de similaridade
            };

            if (!result.details.customer.matches) {
                result.warnings.push('Nome do pagador difere do cliente do pedido');
            }
        } else {
            result.warnings.push('Não foi possível validar o nome do pagador');
        }

        // Resultado final
        result.isValid = result.errors.length === 0;

        return result;
    }

    /**
     * Calcula similaridade entre duas strings
     * @private
     */
    _calculateStringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const costs = new Array();
        for (let i = 0; i <= longer.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= shorter.length; j++) {
                if (i === 0) {
                    costs[j] = j;
                } else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                        newValue = Math.min(
                            Math.min(newValue, lastValue),
                            costs[j]
                        ) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[shorter.length] = lastValue;
        }
        
        return (longer.length - costs[shorter.length]) / longer.length;
    }

    /**
     * Notifica o setor financeiro sobre o pagamento
     * @param {Object} order - Pedido da Nuvemshop
     * @param {Object} proofAnalysis - Análise do comprovante
     */
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