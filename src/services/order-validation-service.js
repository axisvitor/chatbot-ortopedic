const { OrderApi } = require('./nuvemshop/api/order');
const { RedisStore } = require('../store/redis-store');
const { TrackingService } = require('./tracking-service');
const { formatTimeAgo } = require('../utils/date-utils');
const { CACHE_CONFIG } = require('../config/settings');

class OrderValidationService {
    constructor() {
        this.orderApi = new OrderApi();
        this.redisStore = new RedisStore();
        this.trackingService = new TrackingService();
        this.MAX_ATTEMPTS = 3;
        this.BLOCK_TIME = 1800; // 30 minutos em segundos
        this.CACHE_TTL = CACHE_CONFIG.orderTTL || 24 * 3600; // 24 horas em segundos
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
        
        // Verifica se é um número com pelo menos 4 dígitos
        return /^\d{4,}$/.test(cleanText);
    }

    /**
     * Extrai número do pedido do texto
     * @param {string} text - Texto com número do pedido
     * @returns {string|null} Número do pedido ou null
     */
    extractOrderNumber(text) {
        if (!text) return null;
        
        // Remove caracteres especiais e espaços
        const cleanText = text.replace(/[^0-9]/g, '');
        
        // Retorna se for um número válido
        if (this.isValidOrderNumber(cleanText)) {
            return cleanText;
        }
        
        return null;
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

            const order = await this.orderApi.getOrderByNumber(cleanNumber);
            
            if (!order) {
                console.log('❌ Pedido não encontrado:', {
                    numero: cleanNumber,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            // Valida dados mínimos do pedido
            if (!order.number || !order.status) {
                console.log('❌ Dados do pedido incompletos:', {
                    numero: cleanNumber,
                    dados: order,
                    timestamp: new Date().toISOString()
                });
                return null;
            }

            console.log('✅ Pedido validado:', {
                numero: cleanNumber,
                cliente: order.customer?.name,
                status: order.status,
                timestamp: new Date().toISOString()
            });

            // Retorna informações formatadas do pedido
            return this.formatSafeOrderInfo(order);
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
     * @returns {Object} Informações seguras do pedido
     */
    formatSafeOrderInfo(order) {
        try {
            // Log do pedido original para debug
            console.log('📦 Pedido original:', JSON.stringify(order, null, 2));

            // Garantir que temos os dados mínimos
            if (!order || !order.number) {
                throw new Error('Dados do pedido incompletos');
            }

            // Busca código de rastreio e status de envio
            let trackingInfo = {
                number: null,
                url: null,
                status: 'Não disponível'
            };

            if (order.shipping_tracking_number) {
                trackingInfo.number = order.shipping_tracking_number;
                trackingInfo.url = order.shipping_tracking_url;
            } else if (order.fulfillments && order.fulfillments.length > 0) {
                const lastFulfillment = order.fulfillments[order.fulfillments.length - 1];
                if (lastFulfillment.tracking_info?.code) {
                    trackingInfo.number = lastFulfillment.tracking_info.code;
                }
                if (lastFulfillment.status) {
                    trackingInfo.status = lastFulfillment.status.toLowerCase();
                }
            }

            // Formata status de pagamento
            const paymentStatus = order.payment_status === 'pending' ? 'Pendente' :
                                order.payment_status === 'paid' ? 'Pago' :
                                order.payment_status === 'voided' ? 'Cancelado' :
                                'Não disponível';

            const orderInfo = {
                numero_pedido: order.number,
                status: order.status,
                status_pagamento: paymentStatus,
                data_compra: order.created_at ? new Date(order.created_at).toLocaleString('pt-BR') : 'Não disponível',
                valor_total: new Intl.NumberFormat('pt-BR', { 
                    style: 'currency', 
                    currency: order.currency || 'BRL' 
                }).format(order.total || 0),
                produtos: Array.isArray(order.products) ? order.products.map(product => ({
                    nome: product.name,
                    quantidade: parseInt(product.quantity) || 1,
                    preco: new Intl.NumberFormat('pt-BR', { 
                        style: 'currency', 
                        currency: order.currency || 'BRL' 
                    }).format(product.price || 0)
                })) : [],
                status_envio: trackingInfo.status,
                codigo_rastreio: trackingInfo.number,
                url_rastreio: trackingInfo.url,
                cliente: {
                    nome: order.customer?.name || order.client_details?.name || 'Não informado',
                    telefone: order.customer?.phone || order.client_details?.phone || 'Não informado',
                    email: order.customer?.email || order.contact_email || 'Não informado'
                },
                endereco_entrega: order.shipping_address ? {
                    rua: order.shipping_address.address || '',
                    numero: order.shipping_address.number || '',
                    complemento: order.shipping_address.floor || '',
                    bairro: order.shipping_address.locality || '',
                    cidade: order.shipping_address.city || '',
                    estado: order.shipping_address.province || '',
                    cep: order.shipping_address.zipcode || ''
                } : null
            };

            // Log das informações formatadas
            console.log('📋 Informações formatadas:', {
                numero: orderInfo.numero_pedido,
                cliente: orderInfo.cliente.nome,
                status: orderInfo.status,
                rastreio: orderInfo.codigo_rastreio,
                produtos: orderInfo.produtos.length,
                timestamp: new Date().toISOString()
            });

            return orderInfo;
        } catch (error) {
            console.error('❌ Erro ao formatar pedido:', {
                erro: error.message,
                stack: error.stack,
                numero: order?.number,
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
     * Formata mensagem de pedido para WhatsApp
     * @param {Object} orderInfo - Informações seguras do pedido
     * @param {string} userPhone - Telefone do usuário
     * @returns {string} Mensagem formatada
     */
    async formatOrderMessage(orderInfo, userPhone) {
        try {
            if (!orderInfo) {
                throw new Error('Informações do pedido não disponíveis');
            }

            // Log das informações recebidas
            console.log('📝 Formatando mensagem do pedido:', {
                numero: orderInfo.numero_pedido,
                cliente: orderInfo.cliente?.nome,
                status: orderInfo.status,
                rastreio: orderInfo.codigo_rastreio,
                produtos: orderInfo.produtos?.length,
                timestamp: new Date().toISOString()
            });

            // Busca código de rastreio
            const trackingNumber = orderInfo.codigo_rastreio;

            // Armazena informações no Redis se tiver código de rastreio
            if (trackingNumber && userPhone) {
                const trackingKey = `tracking:${userPhone}`;
                const orderKey = `order:${userPhone}`;
                
                await Promise.all([
                    this.redisStore.set(trackingKey, trackingNumber, this.CACHE_TTL),
                    this.redisStore.set(orderKey, orderInfo.numero_pedido, this.CACHE_TTL)
                ]);
                
                console.log('💾 Informações armazenadas:', {
                    telefone: userPhone,
                    pedido: orderInfo.numero_pedido,
                    rastreio: trackingNumber,
                    chaveRastreio: trackingKey,
                    chavePedido: orderKey,
                    ttl: `${this.CACHE_TTL / 3600} horas`,
                    timestamp: new Date().toISOString()
                });
            }

            // Busca status de rastreio se tiver código
            let trackingStatus = null;
            if (trackingNumber) {
                trackingStatus = await this.trackingService.getTrackingStatus(trackingNumber);
            }

            // Monta mensagem base
            let message = `🛍️ *Detalhes do Pedido #${orderInfo.numero_pedido}*\n\n`;
            message += `👤 Cliente: ${orderInfo.cliente?.nome || 'Não informado'}\n`;
            message += `📅 Data: ${orderInfo.data_compra}\n`;
            
            // Status principal do pedido
            const statusPedido = this.orderApi.formatOrderStatusNew(orderInfo.status);
            message += `📦 Status: ${statusPedido}\n`;
            
            // Valor total
            message += `💰 Valor Total: ${this.orderApi.formatPrice(orderInfo.valor_total)}\n\n`;
            
            // Lista de produtos
            if (Array.isArray(orderInfo.produtos) && orderInfo.produtos.length > 0) {
                message += `*Produtos:*\n`;
                orderInfo.produtos.forEach(produto => {
                    message += `▫️ ${produto.quantidade}x ${produto.nome}\n`;
                });
            }

            // Status de envio
            const statusEnvio = this.orderApi.formatOrderStatusNew(orderInfo.status_envio);
            message += `\n📦 Status do Envio: ${statusEnvio}`;

            // Adiciona informações de rastreio se disponível
            if (trackingNumber) {
                message += `\n\n📬 *Rastreamento:*`;
                message += `\nCódigo: ${trackingNumber}`;
                
                if (trackingStatus) {
                    message += `\n${trackingStatus}`;
                } else {
                    message += `\n\nℹ️ Status: Aguardando atualização da transportadora`;
                    message += `\n_O código foi registrado mas ainda não há atualizações disponíveis_`;
                }
            }

            return message;
        } catch (error) {
            console.error('❌ Erro ao formatar mensagem:', {
                erro: error.message,
                stack: error.stack,
                pedido: orderInfo?.numero_pedido,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Busca e formata status de rastreamento
     * @param {string} trackingNumber - Código de rastreio
     * @returns {Promise<string>} Mensagem formatada com status atual
     */
    async getTrackingStatus(trackingNumber) {
        return this.trackingService.getTrackingStatus(trackingNumber);
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
            `🔗 Link: ${trackingInfo.url}\n\n` +
            `Última atualização: ${new Date().toLocaleString('pt-BR')}`;
    }
}

module.exports = { OrderValidationService }; 