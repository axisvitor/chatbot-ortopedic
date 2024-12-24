const { NuvemshopService } = require('./nuvemshop-service');
const { RedisStore } = require('../store/redis-store');

class OrderValidationService {
    constructor() {
        this.nuvemshop = new NuvemshopService();
        this.redisStore = new RedisStore();
        this.MAX_ATTEMPTS = 3;
        this.BLOCK_TIME = 1800; // 30 minutos em segundos
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
     * Valida número do pedido
     * @param {string} orderNumber - Número do pedido
     * @returns {Promise<Object|null>} Pedido ou null se não encontrado
     */
    async validateOrderNumber(orderNumber) {
        try {
            // Remove caracteres especiais e espaços
            const cleanNumber = String(orderNumber).replace(/[^0-9]/g, '');
            
            console.log('🔍 Validando pedido:', {
                numero: cleanNumber,
                numeroOriginal: orderNumber,
                timestamp: new Date().toISOString()
            });

            const order = await this.nuvemshop.getOrderByNumber(cleanNumber);
            
            if (!order) {
                console.log('❌ Pedido não encontrado:', {
                    numero: cleanNumber,
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

            // Busca código de rastreio
            let trackingNumber = null;
            if (order.fulfillments && order.fulfillments.length > 0) {
                const lastFulfillment = order.fulfillments[order.fulfillments.length - 1];
                if (lastFulfillment.tracking_number) {
                    trackingNumber = lastFulfillment.tracking_number;
                }
            }

            const orderInfo = {
                numero_pedido: order.number,
                status: order.status,
                data_compra: order.created_at ? new Date(order.created_at).toLocaleString('pt-BR') : 'Não disponível',
                valor_total: order.total || 0,
                produtos: Array.isArray(order.products) ? order.products.map(product => ({
                    nome: product.name,
                    quantidade: product.quantity
                })) : [],
                status_envio: order.shipping_status || 'Não disponível',
                codigo_rastreio: trackingNumber,
                cliente: {
                    nome: order.customer?.name || order.client_details?.name || 'Não informado',
                    telefone: order.customer?.phone || order.client_details?.phone || 'Não informado'
                }
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

            let message = `🛍️ *Detalhes do Pedido #${orderInfo.numero_pedido}*\n\n`;
            message += `👤 Cliente: ${orderInfo.cliente?.nome || 'Não informado'}\n`;
            message += `📅 Data: ${orderInfo.data_compra}\n`;
            
            // Status principal do pedido
            const statusPedido = this.nuvemshop.formatOrderStatus(orderInfo.status);
            message += `📦 Status: ${statusPedido}\n`;
            
            // Valor total
            message += `💰 Valor Total: ${this.nuvemshop.formatPrice(orderInfo.valor_total)}\n\n`;
            
            // Lista de produtos
            if (Array.isArray(orderInfo.produtos) && orderInfo.produtos.length > 0) {
                message += `*Produtos:*\n`;
                orderInfo.produtos.forEach(produto => {
                    message += `▫️ ${produto.quantidade}x ${produto.nome}\n`;
                });
            }

            // Status de envio
            const statusEnvio = this.nuvemshop.formatOrderStatus(orderInfo.status_envio);
            message += `\n📦 Status do Envio: ${statusEnvio}`;
            
            // Código de rastreio
            if (orderInfo.codigo_rastreio) {
                message += `\n📬 Código de Rastreio: ${orderInfo.codigo_rastreio}`;
                message += `\n\n_Para ver o status atual do seu pedido, digite "rastrear" ou "status da entrega"_`;
                
                // Armazena o código de rastreio no Redis para consulta rápida
                if (userPhone) {
                    const trackingKey = `tracking:${userPhone}`;
                    const orderKey = `order:${userPhone}`;
                    
                    await Promise.all([
                        // Armazena código de rastreio
                        this.redisStore.set(trackingKey, orderInfo.codigo_rastreio, 3600 * 24), // 24 horas
                        // Armazena número do pedido
                        this.redisStore.set(orderKey, orderInfo.numero_pedido, 3600 * 24)
                    ]);
                    
                    console.log('💾 Informações armazenadas:', {
                        telefone: userPhone,
                        pedido: orderInfo.numero_pedido,
                        rastreio: orderInfo.codigo_rastreio,
                        chaveRastreio: trackingKey,
                        chavePedido: orderKey,
                        timestamp: new Date().toISOString()
                    });
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
        if (!trackingNumber) return null;

        try {
            console.log('🔍 Buscando status no 17track:', {
                codigo: trackingNumber,
                timestamp: new Date().toISOString()
            });

            // Busca status atual no 17track
            const response = await fetch('https://api.17track.net/track/v2/gettrackinfo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    '17token': process.env.TRACK17_TOKEN
                },
                body: JSON.stringify({
                    numbers: [trackingNumber],
                    carrier: 'correioscn'
                })
            });

            const data = await response.json();
            console.log('📦 Resposta do 17track:', {
                codigo: trackingNumber,
                status: data?.ret,
                dados: data?.data?.[0],
                timestamp: new Date().toISOString()
            });

            if (data?.ret === 1 && data?.data?.[0]?.track) {
                const track = data.data[0].track;
                const lastEvent = track.z0?.z[track.z0.z.length - 1];

                if (lastEvent) {
                    return `🚚 *Status do Rastreamento*\n\n` +
                        `📦 Código: ${trackingNumber}\n` +
                        `📍 Local: ${lastEvent.z || 'Não disponível'}\n` +
                        `📅 Data: ${new Date(lastEvent.a * 1000).toLocaleString('pt-BR')}\n` +
                        `📝 Status: ${lastEvent.c}\n\n` +
                        `_Última atualização ${this.formatTimeAgo(lastEvent.a)}_`;
                }
            }

            return `🚚 *Status do Rastreamento*\n\n` +
                `📦 Código: ${trackingNumber}\n` +
                `ℹ️ Status: Aguardando atualização da transportadora\n\n` +
                `_O código foi registrado mas ainda não há atualizações disponíveis_`;

        } catch (error) {
            console.error('❌ Erro ao buscar rastreio:', {
                erro: error.message,
                stack: error.stack,
                codigo: trackingNumber,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Formata tempo decorrido
     * @param {number} timestamp - Timestamp em segundos
     * @returns {string} Tempo formatado
     */
    formatTimeAgo(timestamp) {
        const now = Math.floor(Date.now() / 1000);
        const seconds = now - timestamp;
        
        const intervals = {
            ano: 31536000,
            mes: 2592000,
            semana: 604800,
            dia: 86400,
            hora: 3600,
            minuto: 60
        };

        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            
            if (interval >= 1) {
                return `há ${interval} ${unit}${interval > 1 ? 's' : ''}`;
            }
        }
        
        return 'agora mesmo';
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