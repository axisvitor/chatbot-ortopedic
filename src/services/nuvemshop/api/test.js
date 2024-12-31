const { OrderApi } = require('./order');
const { NUVEMSHOP_CONFIG } = require('../../../config/settings');

async function testOrderSearch() {
    try {
        console.log('Config:', {
            apiUrl: NUVEMSHOP_CONFIG.apiUrl,
            userId: NUVEMSHOP_CONFIG.userId,
            tokenLength: NUVEMSHOP_CONFIG.accessToken.length
        });

        const orderApi = new OrderApi();
        console.log('Buscando pedido...');
        const order = await orderApi.getOrder('1623071044'); // ID do pedido
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
