const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { OPENAI_CONFIG } = require('../config/settings');

class WhatsAppImageService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.openaiAxios = axios.create({
            baseURL: 'https://api.openai.com/v1',
            headers: {
                'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async downloadImage(imageMessage) {
        try {
            console.log('📥 Iniciando download da imagem do WhatsApp...');
            
            if (!imageMessage?.url) {
                throw new Error('URL da imagem não encontrada na mensagem');
            }

            // Garante que o mimetype é suportado
            const supportedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
            const mimetype = imageMessage.mimetype || 'image/jpeg';
            
            if (!supportedTypes.includes(mimetype)) {
                throw new Error(`Tipo de imagem não suportado: ${mimetype}. Use: ${supportedTypes.join(', ')}`);
            }

            // Gera um nome único para o arquivo temporário com a extensão correta
            const extension = mimetype.split('/')[1];
            const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-'));
            const tempFile = path.join(tempDir, `${uuidv4()}.${extension}`);

            // Faz o download da imagem
            const response = await axios({
                method: 'get',
                url: imageMessage.url,
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'WhatsApp/2.23.24.82'
                }
            });

            // Salva a imagem no arquivo temporário
            await fs.writeFile(tempFile, response.data);

            // Converte para base64
            const base64Image = Buffer.from(response.data).toString('base64');

            console.log('✅ Download da imagem concluído:', {
                tamanho: response.data.length,
                arquivo: tempFile,
                mimetype: mimetype
            });

            return {
                filePath: tempFile,
                mimetype: mimetype,
                caption: imageMessage.caption,
                base64: base64Image
            };

        } catch (error) {
            console.error('❌ Erro ao baixar imagem do WhatsApp:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async analyzeImage(imageMessage) {
        try {
            console.log('🔍 Iniciando análise da imagem...');

            // 1. Download da imagem
            const imageData = await this.downloadImage(imageMessage);

            // 2. Prepara o prompt para análise com OpenAI Vision
            const messages = [{
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Analise este comprovante de pagamento e extraia as seguintes informações:
                            - Valor da transação
                            - Data da transação
                            - Tipo de transação (PIX, transferência, boleto, etc)
                            - Status do pagamento
                            - Informações adicionais relevantes
                            
                            Contexto adicional: ${imageData.caption || 'Nenhum'}`
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${imageData.mimetype};base64,${imageData.base64}`,
                            detail: 'high'
                        }
                    }
                ]
            }];

            // 3. Envia para análise na OpenAI Vision
            console.log('🤖 Enviando para análise na OpenAI Vision...');
            const response = await this.openaiAxios.post('/chat/completions', {
                model: 'gpt-4o-mini',
                messages: messages,
                temperature: 0.7,
                max_tokens: 1024
            });

            // 4. Limpa arquivos temporários
            await fs.unlink(imageData.filePath);
            await fs.rmdir(path.dirname(imageData.filePath));

            console.log('✅ Análise concluída');

            return response.data.choices[0].message.content;

        } catch (error) {
            console.error('❌ Erro ao analisar imagem:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async processPaymentProof(imageMessage) {
        try {
            console.log('💳 Processando comprovante de pagamento...');

            // 1. Analisa a imagem
            const analysisResult = await this.analyzeImage(imageMessage);

            // 2. Extrai informações do texto da análise
            const paymentInfo = this.extractPaymentInfo(analysisResult);

            console.log('💰 Informações extraídas:', paymentInfo);

            return paymentInfo;

        } catch (error) {
            console.error('❌ Erro ao processar comprovante:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    extractPaymentInfo(analysisText) {
        // Converte o texto para minúsculo para facilitar a busca
        const text = analysisText.toLowerCase();
        
        return {
            isPaymentProof: this.isPaymentProof(text),
            amount: this.extractAmount(text),
            date: this.extractDate(text),
            transactionType: this.extractTransactionType(text),
            status: this.extractStatus(text)
        };
    }

    isPaymentProof(text) {
        const keywords = ['comprovante', 'pagamento', 'transferência', 'pix', 'recibo'];
        return keywords.some(keyword => text.includes(keyword));
    }

    extractAmount(text) {
        const amountRegex = /r\$\s*(\d+(?:\.\d{3})*(?:,\d{2})?)/;
        const match = text.match(amountRegex);
        if (match) {
            return match[1].replace('.', '').replace(',', '.');
        }
        return null;
    }

    extractDate(text) {
        const dateRegex = /(\d{2}\/\d{2}\/\d{4})|(\d{2}\/\d{2}\/\d{2})/;
        const match = text.match(dateRegex);
        return match ? match[0] : null;
    }

    extractTransactionType(text) {
        if (text.includes('pix')) return 'pix';
        if (text.includes('transferência') || text.includes('transferencia')) return 'transfer';
        if (text.includes('boleto')) return 'boleto';
        if (text.includes('cartão') || text.includes('cartao')) return 'card';
        return 'unknown';
    }

    extractStatus(text) {
        if (text.includes('confirmado') || text.includes('aprovado') || text.includes('concluído') || text.includes('sucesso')) {
            return 'confirmed';
        }
        if (text.includes('pendente') || text.includes('aguardando')) {
            return 'pending';
        }
        if (text.includes('falhou') || text.includes('recusado') || text.includes('negado')) {
            return 'failed';
        }
        return 'unknown';
    }
}

module.exports = { WhatsAppImageService };
