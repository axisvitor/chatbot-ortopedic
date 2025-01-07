const axios = require('axios');
const { logger } = require('../utils/logger');

class NuvemshopService {
    constructor() {
        this.client = axios.create({
            baseURL: process.env.NUVEMSHOP_API_URL,
            headers: {
                'Authentication': `bearer ${process.env.NUVEMSHOP_ACCESS_TOKEN}`,
                'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    async getNewOrdersWithTracking(limit = 100) {
        try {
            // Busca pedidos dos últimos 30 dias
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const response = await this.client.get('/orders', {
                params: {
                    created_at_min: thirtyDaysAgo.toISOString(),
                    per_page: limit
                }
            });

            // Log detalhado de todos os pedidos
            response.data.forEach(order => {
                logger.info(`\nPedido #${order.number}:
                    - ID: ${order.id}
                    - Status: ${order.status}
                    - Data de criação: ${new Date(order.created_at).toLocaleString()}
                    - Status de envio: ${order.shipping_status}
                    - Código de rastreio: ${order.shipping_tracking_number || 'Não disponível'}
                    - URL de rastreio: ${order.shipping_tracking_url || 'Não disponível'}
                    - Transportadora: ${order.shipping_carrier_name || 'Não especificada'}
                    - Cliente: ${order.customer.name}
                    - Email: ${order.customer.email}
                    - Telefone: ${order.customer.phone}
                    - Endereço de entrega:
                        * ${order.shipping_address.address}, ${order.shipping_address.number}
                        * ${order.shipping_address.floor || ''}
                        * ${order.shipping_address.locality}, ${order.shipping_address.city} - ${order.shipping_address.province}
                        * CEP: ${order.shipping_address.zipcode}
                    - Produtos:
                        ${order.products.map(product => `* ${product.name} (${product.quantity}x)`).join('\n                        ')}
                `);
            });

            logger.info(`Total de pedidos encontrados: ${response.data.length}`);
            return response.data;
        } catch (error) {
            logger.error('Erro ao buscar pedidos da Nuvemshop:', error);
            throw error;
        }
    }
}

module.exports = NuvemshopService;
