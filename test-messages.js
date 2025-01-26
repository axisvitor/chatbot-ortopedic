require('dotenv').config();
const { OpenAIService } = require('./src/services/openai-service');

async function testMessageProcessing() {
    try {
        // Inicializa o serviço OpenAI (com serviços mock)
        const openAIService = new OpenAIService(
            {}, // nuvemshopService mock
            {}, // trackingService mock
            {}, // businessHoursService mock
            {}, // orderValidationService mock
            {}, // financialService mock
            {}, // departmentService mock
            {}  // whatsappService mock
        );

        console.log('Iniciando teste de processamento de mensagens...');

        // Simula um customerId
        const customerId = 'test-customer-' + Date.now();

        // Array de mensagens para testar
        const messages = [
            "Olá, gostaria de saber sobre meu pedido #12345",
            "Qual o status do meu pedido?",
            "Obrigado pela ajuda!"
        ];

        console.log('\nEnviando mensagens em sequência...\n');

        // Processa cada mensagem
        for (const message of messages) {
            console.log(`\nEnviando mensagem: "${message}"`);
            const response = await openAIService.processCustomerMessage(customerId, message);
            console.log('Resposta:', response);
            
            // Pequeno delay entre mensagens
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\nTeste concluído!');
        process.exit(0);
    } catch (error) {
        console.error('Erro durante o teste:', error);
        process.exit(1);
    }
}

// Executa o teste
testMessageProcessing();
