const { GroqServices } = require('./services/groq-services');

async function testarServicos() {
    try {
        const groqServices = new GroqServices();
        
        // Exemplo de dados do webhook do WhatsApp para áudio
        const audioData = {
            message: {
                audioMessage: {
                    url: "URL_DO_AUDIO_AQUI",
                    mimetype: "audio/opus",
                    seconds: 10,
                    fileLength: 1024 * 1024, // 1MB exemplo
                    ptt: true
                }
            }
        };

        // Exemplo de URL de imagem
        const imageUrl = "URL_DA_IMAGEM_AQUI";

        console.log('🎯 Iniciando testes do Groq Services...\n');

        // Teste de transcrição de áudio
        console.log('🎤 Testando transcrição de áudio...');
        try {
            const transcricao = await groqServices.processWhatsAppAudio(audioData);
            console.log('✅ Resultado da transcrição:', transcricao, '\n');
        } catch (error) {
            console.error('❌ Erro na transcrição:', error.message, '\n');
        }

        // Teste de análise de imagem
        console.log('🖼️ Testando análise de imagem...');
        try {
            const analise = await groqServices.analyzeImage(imageUrl);
            console.log('✅ Resultado da análise:', analise, '\n');
        } catch (error) {
            console.error('❌ Erro na análise:', error.message, '\n');
        }

    } catch (error) {
        console.error('❌ Erro geral:', error);
    }
}

// Executa os testes
testarServicos(); 