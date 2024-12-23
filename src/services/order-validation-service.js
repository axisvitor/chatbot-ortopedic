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
            // Remove o "#" se presente e qualquer espaço em branco
            const cleanOrderNumber = orderNumber.replace(/[#\s]/g, '');
            
            console.log('[OrderValidation] Validando pedido:', {
                numeroOriginal: orderNumber,
                numeroLimpo: cleanOrderNumber,
                timestamp: new Date().toISOString()
            });

            const order = await this.nuvemshop.getOrderByNumber(cleanOrderNumber);
            
            if (!order) {
                return null;
            }

            // Retorna informações formatadas do pedido
            return this.formatSafeOrderInfo(order);
        } catch (error) {
            console.error('[OrderValidation] Erro ao validar número do pedido:', error);
            return null;
        }
    }

    /**
     * Formata informações seguras do pedido
     * @param {Object} order - Pedido completo
     * @returns {Object} Informações seguras do pedido
     */
    formatSafeOrderInfo(order) {
        return {
            numero_pedido: order.number,
            status: this.nuvemshop.formatOrderStatus(order.status),
            data_compra: new Date(order.created_at).toLocaleString('pt-BR'),
            valor_total: this.nuvemshop.formatPrice(order.total),
            produtos: order.products.map(product => ({
                nome: product.name,
                quantidade: product.quantity
            })),
            status_envio: order.shipping_status ? 
                this.nuvemshop.formatOrderStatus(order.shipping_status) : 
                'Não disponível',
            codigo_rastreio: order.shipping_tracking_number || null,
            cliente: {
                nome: order.customer?.name || 'Não informado'
            }
        };
    }

    /**
     * Formata mensagem de pedido para WhatsApp
     * @param {Object} orderInfo - Informações seguras do pedido
     * @returns {string} Mensagem formatada
     */
    formatOrderMessage(orderInfo) {
        let message = `🛍️ *Detalhes do Pedido #${orderInfo.numero_pedido}*\n\n`;
        message += `👤 Cliente: ${orderInfo.cliente.nome}\n`;
        message += `📅 Data: ${orderInfo.data_compra}\n`;
        message += `📦 Status: ${orderInfo.status}\n`;
        message += `💰 Valor Total: ${orderInfo.valor_total}\n\n`;
        
        message += `*Produtos:*\n`;
        orderInfo.produtos.forEach(produto => {
            message += `▫️ ${produto.quantidade}x ${produto.nome}\n`;
        });

        message += `\n📦 Status do Envio: ${orderInfo.status_envio}`;
        
        if (orderInfo.codigo_rastreio) {
            message += `\n📬 Código de Rastreio: ${orderInfo.codigo_rastreio}`;
            message += `\n\n_Para rastrear seu pedido, basta me enviar o código de rastreio acima._`;
        }

        return message;
    }
}

module.exports = { OrderValidationService }; 