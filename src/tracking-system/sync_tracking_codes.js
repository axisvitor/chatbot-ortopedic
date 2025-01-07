require('dotenv').config({ path: '../../../.env' });
const { RedisStore } = require('./utils/redis-store');
const axios = require('axios');
const logger = require('./utils/logger');

class NuvemshopTrackingSync {
    constructor() {
        this.redis = new RedisStore();
        this.apiKey = process.env.NUVEMSHOP_ACCESS_TOKEN;
        this.userId = process.env.NUVEMSHOP_USER_ID;
        this.baseUrl = process.env.NUVEMSHOP_API_URL;
    }

    async getOrdersFromLastMonth() {
        try {
            // Pegar o início do dia atual
            const now = new Date();
            now.setHours(0, 0, 0, 0);
            
            // Calcular exatamente 30 dias atrás à meia-noite
            const thirtyDaysAgo = new Date(now);
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            console.log('Data inicial:', thirtyDaysAgo.toISOString());
            console.log('Fazendo requisição para:', this.baseUrl);
            console.log('Token:', this.apiKey);
            
            const headers = {
                'Authentication': `bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'API Loja Ortopedic (suporte@lojaortopedic.com.br)',
                'Accept': 'application/json'
            };

            let allOrders = [];
            let page = 1;
            let hasMore = true;

            while (hasMore) {
                try {
                    console.log(`\nBuscando página ${page}...`);
                    const response = await axios.get(`${this.baseUrl}/orders`, {
                        headers,
                        params: {
                            updated_at_min: thirtyDaysAgo.toISOString(),
                            per_page: 200,
                            page
                        }
                    });

                    const orders = response.data;
                    if (orders && orders.length > 0) {
                        allOrders = allOrders.concat(orders);
                        page++;
                    } else {
                        hasMore = false;
                    }
                } catch (error) {
                    if (error.response && error.response.status === 404) {
                        // Não há mais páginas
                        hasMore = false;
                    } else {
                        throw error;
                    }
                }
            }

            console.log(`Total de pedidos encontrados: ${allOrders.length}`);
            return allOrders;
        } catch (error) {
            console.error('Erro ao buscar pedidos:', error.message);
            return [];
        }
    }

    async syncTrackingCodes() {
        try {
            console.log('Iniciando sincronização dos códigos de rastreio...');
            
            // Busca os pedidos dos últimos 30 dias
            const orders = await this.getOrdersFromLastMonth();
            console.log(`Encontrados ${orders.length} pedidos nos últimos 30 dias`);

            let syncCount = 0;
            let noTrackingCount = 0;
            
            // Para cada pedido, verifica e salva o código de rastreio
            for (const order of orders) {
                console.log(`\nAnalisando pedido #${order.number}:`);
                
                // Procura por um fulfillment com código de rastreio
                const fulfillment = order.fulfillments?.find(f => f.tracking_info?.code);
                
                if (fulfillment?.tracking_info?.code) {
                    const trackingData = {
                        code: fulfillment.tracking_info.code,
                        carrier: fulfillment.shipping?.carrier?.name || 'Correios',
                        status: fulfillment.status || 'pendente',
                        lastUpdate: order.updated_at,
                        estimatedDelivery: 'N/A',
                        orderStatus: order.status,
                        customerName: order.customer?.name || 'N/A',
                        orderTotal: order.total?.toString() || '0',
                        shippingAddress: JSON.stringify({
                            address: order.shipping_address?.address,
                            number: order.shipping_address?.number,
                            complement: order.shipping_address?.floor,
                            neighborhood: order.shipping_address?.locality,
                            city: order.shipping_address?.city,
                            state: order.shipping_address?.province,
                            zipcode: order.shipping_address?.zipcode
                        })
                    };

                    await this.redis.saveTrackingCode(order.number.toString(), trackingData);
                    console.log(`✓ Código de rastreio salvo: ${trackingData.code}`);
                    syncCount++;
                } else {
                    noTrackingCount++;
                    console.log('✗ Sem código de rastreio');
                }
            }

            console.log(`\nSincronização concluída!`);
            console.log(`- ${syncCount} códigos de rastreio salvos no Redis`);
            console.log(`- ${noTrackingCount} pedidos sem código de rastreio`);
        } catch (error) {
            console.error('Erro durante a sincronização:', error.message);
        } finally {
            await this.redis.disconnect();
        }
    }
}

// Executar a sincronização
const sync = new NuvemshopTrackingSync();
sync.syncTrackingCodes().then(() => {
    console.log('Processo de sincronização finalizado');
});
