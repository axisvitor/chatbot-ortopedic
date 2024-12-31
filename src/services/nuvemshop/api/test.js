const { OrderApi } = require('./order');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');
const { NuvemshopService } = require('../../nuvemshop-service');

async function testOrderSearch() {
    try {
        console.log('Config:', {
            apiUrl: NUVEMSHOP_CONFIG.apiUrl,
            userId: NUVEMSHOP_CONFIG.userId,
            tokenLength: NUVEMSHOP_CONFIG.accessToken.length
        });

        const nuvemshop = new NuvemshopService();
        console.log('Buscando pedido...');
        const order = await nuvemshop.getOrderByNumber('2913');
        console.log('Resultado:', JSON.stringify(order, null, 2));
    } catch (error) {
        console.error('Erro:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Detalhes:', JSON.stringify(error.response.data, null, 2));
            console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
        }
    }
}

testOrderSearch();
