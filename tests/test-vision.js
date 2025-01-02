require('dotenv').config();
const { WhatsAppImageService } = require('../src/services/whatsapp-image-service');
const { GroqServices } = require('../src/services/groq-services');

async function testVisionAPI() {
    try {
        console.log('🧪 Iniciando teste da API de Visão...');

        // Mock de uma mensagem do WhatsApp com a imagem do comunicado
        const mockMessage = {
            url: 'https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/data/christmas-card.jpg',
            mimetype: 'image/jpeg',
            caption: 'Comunicado de Natal'
        };

        // Inicializa os serviços
        const groqServices = new GroqServices();
        const imageService = new WhatsAppImageService(groqServices);

        // Testa a análise da imagem
        console.log('🔍 Analisando imagem...');
        const result = await imageService.analyzeImage(mockMessage);

        console.log('✅ Resultado da análise:', result);

    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

// Executa o teste
testVisionAPI();
