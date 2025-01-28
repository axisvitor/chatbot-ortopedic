const { NUVEMSHOP_CONFIG } = require('../config/settings');

class NuvemshopFormatter {
    constructor() {
        this.config = NUVEMSHOP_CONFIG.format;
    }

    /**
     * Formata o status do pedido para exibição
     * @param {string} status - Status original do pedido
     * @returns {string} Status formatado
     */
    formatOrderStatus(status) {
        if (!status) return 'Não disponível';

        const statusMap = {
            // Status do pedido
            'open': 'Em aberto',
            'closed': 'Concluído',
            'cancelled': 'Cancelado',
            
            // Status de pagamento
            'pending': 'Pendente',
            'paid': 'Pago',
            'unpaid': 'Não pago',
            'partially_paid': 'Parcialmente pago',
            'refunded': 'Reembolsado',
            'partially_refunded': 'Parcialmente reembolsado',
            
            // Status de envio
            'shipped': 'Enviado',
            'unshipped': 'Não enviado',
            'partially_shipped': 'Parcialmente enviado',
            'ready_to_ship': 'Pronto para envio',
            'in_transit': 'Em trânsito',
            'delivered': 'Entregue',
            'ready_for_pickup': 'Pronto para retirada',
            'packed': 'Embalado'
        };

        return statusMap[status?.toLowerCase()] || status;
    }

    /**
     * Formata o status de envio para exibição
     * @param {string} status - Status original do envio
     * @returns {string} Status formatado
     */
    formatShippingStatus(status) {
        if (!status) return 'Não disponível';

        const statusMap = {
            'ready_for_shipping': 'Pronto para envio',
            'shipped': 'Enviado',
            'delivered': 'Entregue',
            'undelivered': 'Não entregue',
            'returned': 'Devolvido',
            'lost': 'Extraviado',
            'in_transit': 'Em trânsito'
        };

        return statusMap[status?.toLowerCase()] || status;
    }

    /**
     * Formata preço para exibição
     * @param {number} value - Valor a ser formatado
     * @param {Object} options - Opções de formatação
     * @returns {string} Valor formatado
     */
    formatPrice(value, options = {}) {
        if (value === null || value === undefined) return 'R$ 0,00';

        const defaultOptions = {
            locale: this.config.priceFormat.locale,
            currency: this.config.priceFormat.currency,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        };

        const finalOptions = { ...defaultOptions, ...options };

        return new Intl.NumberFormat(finalOptions.locale, {
            style: 'currency',
            currency: finalOptions.currency,
            minimumFractionDigits: finalOptions.minimumFractionDigits,
            maximumFractionDigits: finalOptions.maximumFractionDigits
        }).format(value);
    }

    /**
     * Formata dimensões do produto
     * @param {Object} variant - Variante do produto
     * @returns {Object} Dimensões formatadas
     */
    formatProductDimensions(variant) {
        if (!variant) return null;

        const { width, height, depth, weight } = variant;

        return {
            width: width ? `${width} cm` : null,
            height: height ? `${height} cm` : null,
            depth: depth ? `${depth} cm` : null,
            weight: weight ? `${weight} kg` : null,
            formatted: [
                width && `L: ${width}cm`,
                height && `A: ${height}cm`,
                depth && `P: ${depth}cm`,
                weight && `${weight}kg`
            ].filter(Boolean).join(' x ')
        };
    }

    /**
     * Formata o resumo do pedido para exibição
     * @param {Object} order - Dados do pedido
     * @returns {string} Resumo formatado
     */
    formatOrderSummary(order) {
        if (!order) return null;
        
        return `🛍️ *Pedido #${order.number}*
📅 Data: ${new Date(order.created_at).toLocaleDateString('pt-BR')}
💰 Total: ${this.formatPrice(order.total)}
📦 Status: ${this.formatOrderStatus(order.status)}
💳 Pagamento: ${this.formatOrderStatus(order.payment_status)}`;
    }

    /**
     * Formata resposta de pedido para o chatbot
     * @param {Object} order - Dados do pedido
     * @returns {Object} Resposta formatada
     */
    formatOrderResponse(order) {
        if (!order) return null;

        return {
            number: order.number,
            status: this.formatOrderStatus(order.status),
            total: this.formatPrice(order.total),
            createdAt: new Date(order.created_at).toLocaleDateString('pt-BR'),
            customer: order.customer?.name,
            shipping: {
                status: order.shipping_status ? this.formatShippingStatus(order.shipping_status) : null,
                trackingNumber: order.shipping_tracking_number,
                trackingUrl: order.shipping_tracking_url
            },
            products: order.products?.map(product => ({
                name: product.name,
                quantity: product.quantity,
                price: this.formatPrice(product.price)
            }))
        };
    }

    /**
     * Formata resposta de produto para o chatbot
     * @param {Object} product - Dados do produto
     * @returns {Object} Resposta formatada
     */
    formatProductResponse(product) {
        if (!product) return null;

        const mainVariant = product.variants?.[0];
        const dimensions = mainVariant ? this.formatProductDimensions(mainVariant) : null;

        return {
            name: product.name,
            description: product.description,
            price: mainVariant ? this.formatPrice(mainVariant.price) : null,
            stock: mainVariant?.stock || 0,
            brand: product.brand,
            dimensions: dimensions?.formatted,
            image: product.images?.[0]?.url,
            url: product.permalink,
            variants: product.variants?.map(variant => ({
                name: variant.name,
                price: this.formatPrice(variant.price),
                stock: variant.stock,
                sku: variant.sku
            }))
        };
    }

    /**
     * Formata data para exibição
     * @param {string|Date} date - Data a ser formatada
     * @returns {string} Data formatada
     */
    formatDate(date) {
        if (!date) return null;
        return new Date(date).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

module.exports = { NuvemshopFormatter };
