require('dotenv').config();
const { WhatsAppImageService } = require('../src/services/whatsapp-image-service');
const { GroqServices } = require('../src/services/groq-services');

async function testImageAnalysis() {
    try {
        console.log('🧪 Iniciando teste de análise de imagem...');

        // Simula uma mensagem do WhatsApp com uma imagem de comprovante
        const mockImageMessage = {
            url: 'https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/data/image-bank-statement.png',
            mimetype: 'image/png',
            caption: 'Comprovante de pagamento'
        };

        // Inicializa os serviços
        const groqServices = new GroqServices();
        const whatsappImageService = new WhatsAppImageService(groqServices);

        console.log('📥 Processando imagem...');
        const result = await whatsappImageService.processPaymentProof(mockImageMessage);

        console.log('✅ Resultado da análise:', JSON.stringify(result, null, 2));

    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

testImageAnalysis();
