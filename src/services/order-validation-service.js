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
                numero: orderNumber,
                erro: error.message,
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
            console.log('🔄 Formatando informações do pedido:', {
                numero: order.number,
                cliente: order.customer?.name || order.client_details?.name,
                status: order.status,
                timestamp: new Date().toISOString()
            });

            return {
                numero_pedido: order.number,
                status: order.status,
                data_compra: new Date(order.created_at).toLocaleString('pt-BR'),
                valor_total: order.total,
                produtos: order.products.map(product => ({
                    nome: product.name,
                    quantidade: product.quantity
                })),
                status_envio: order.shipping_status || 'Não disponível',
                codigo_rastreio: order.shipping_tracking_number || null,
                cliente: {
                    nome: order.customer?.name || order.client_details?.name || 'Não informado',
                    telefone: order.customer?.phone || order.client_details?.phone || 'Não informado'
                }
            };
        } catch (error) {
            console.error('❌ Erro ao formatar pedido:', {
                erro: error.message,
                numero: order?.number,
                timestamp: new Date().toISOString()
            });
            return null;
        }
    }

    /**
     * Formata mensagem de pedido para WhatsApp
     * @param {Object} orderInfo - Informações seguras do pedido
     * @returns {string} Mensagem formatada
     */
    async formatOrderMessage(orderInfo) {
        try {
            if (!orderInfo) {
                throw new Error('Informações do pedido não disponíveis');
            }

            let message = `🛍️ *Detalhes do Pedido #${orderInfo.numero_pedido}*\n\n`;
            message += `👤 Cliente: ${orderInfo.cliente.nome}\n`;
            message += `📅 Data: ${orderInfo.data_compra}\n`;
            message += `📦 Status: ${this.nuvemshop.formatOrderStatus(orderInfo.status)}\n`;
            message += `💰 Valor Total: ${this.nuvemshop.formatPrice(orderInfo.valor_total)}\n\n`;
            
            message += `*Produtos:*\n`;
            orderInfo.produtos.forEach(produto => {
                message += `▫️ ${produto.quantidade}x ${produto.nome}\n`;
            });

            message += `\n📦 Status do Envio: ${this.nuvemshop.formatOrderStatus(orderInfo.status_envio)}`;
            
            if (orderInfo.codigo_rastreio) {
                message += `\n📬 Código de Rastreio: ${orderInfo.codigo_rastreio}`;
                message += `\n\n_Para ver o status atual do seu pedido, digite "rastrear" ou "status da entrega"_`;
                
                // Armazena o código de rastreio no Redis para consulta rápida
                const trackingKey = `tracking:${orderInfo.cliente.telefone}`;
                await this.redisStore.set(trackingKey, orderInfo.codigo_rastreio, 3600); // 1 hora de TTL
            }

            return message;
        } catch (error) {
            console.error('❌ Erro ao formatar mensagem:', {
                erro: error.message,
                pedido: orderInfo?.numero_pedido,
                timestamp: new Date().toISOString()
            });
            return 'Desculpe, houve um erro ao formatar as informações do pedido. Por favor, tente novamente.';
        }
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