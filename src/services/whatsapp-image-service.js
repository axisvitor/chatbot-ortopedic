const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { OPENAI_CONFIG } = require('../config/settings');

class WhatsAppImageService {
    constructor() {
        this.openaiAxios = axios.create({
            baseURL: 'https://api.openai.com/v1',
            headers: {
                'Authorization': `Bearer ${OPENAI_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Extrai o número do remetente da mensagem de forma robusta
     * @param {Object} message - Mensagem do WhatsApp
     * @returns {string} Número do remetente (apenas dígitos)
     */
    extractSenderNumber(message) {
        try {
            console.log('📱 Extraindo remetente da mensagem:', {
                temKey: !!message?.key,
                temRemoteJid: !!message?.key?.remoteJid,
                temParticipant: !!message?.key?.participant,
                estrutura: JSON.stringify(message, null, 2)
            });

            // Em grupos, usa participant. Em 1:1, usa remoteJid
            const senderId = message?.key?.participant || message?.key?.remoteJid;
            
            if (!senderId) {
                console.error('❌ Dados da mensagem:', JSON.stringify(message, null, 2));
                throw new Error('Remetente não encontrado na mensagem (key.remoteJid ou key.participant ausentes)');
            }

            // Remove tudo que não for dígito (ex: @s.whatsapp.net, @g.us)
            return senderId.split('@')[0];
        } catch (error) {
            console.error('❌ Erro ao extrair remetente:', {
                erro: error.message,
                stack: error.stack,
                mensagem: JSON.stringify(message, null, 2)
            });
            throw error;
        }
    }

    async downloadImages(imageMessages) {
        try {
            console.log('📥 Iniciando download das imagens do WhatsApp...', {
                mensagens: JSON.stringify(imageMessages, null, 2)
            });
            
            if (!Array.isArray(imageMessages)) {
                imageMessages = [imageMessages];
            }

            // Valida se há mensagens
            if (!imageMessages?.length) {
                throw new Error('Nenhuma mensagem de imagem fornecida');
            }

            const downloadedImages = await Promise.all(imageMessages.map(async (imageMessage) => {
                console.log('Processando mensagem:', JSON.stringify(imageMessage, null, 2));

                // Extrai o remetente usando a nova função robusta
                const from = this.extractSenderNumber(imageMessage);

                // Extrai URL da mensagem
                const url = imageMessage?.url || 
                          imageMessage?.imageMessage?.url || 
                          imageMessage?.directPath;  // Adicionado directPath como fallback

                if (!url) {
                    throw new Error('URL da imagem não encontrada na mensagem');
                }

                // Garante que o mimetype é suportado
                const supportedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                const mimetype = imageMessage?.mimetype || 
                               imageMessage?.imageMessage?.mimetype || 
                               'image/jpeg';
                
                if (!supportedTypes.includes(mimetype)) {
                    throw new Error(`Tipo de imagem não suportado: ${mimetype}. Use: ${supportedTypes.join(', ')}`);
                }

                // Gera um nome único para o arquivo temporário com a extensão correta
                const extension = mimetype.split('/')[1];
                const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'whatsapp-'));
                const tempFile = path.join(tempDir, `${uuidv4()}.${extension}`);

                // Faz o download da imagem com retry em caso de falha
                let response;
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount < maxRetries) {
                    try {
                        response = await axios({
                            method: 'get',
                            url: url,
                            responseType: 'arraybuffer',
                            headers: {
                                'User-Agent': 'WhatsApp/2.23.24.82'
                            },
                            timeout: 10000 // 10 segundos
                        });
                        break;
                    } catch (error) {
                        retryCount++;
                        if (retryCount === maxRetries) throw error;
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    }
                }

                // Salva a imagem no arquivo temporário
                await fs.writeFile(tempFile, response.data);

                // Converte para base64
                const base64Image = Buffer.from(response.data).toString('base64');

                console.log('✅ Download da imagem concluído:', {
                    tamanho: response.data.length,
                    arquivo: tempFile,
                    mimetype: mimetype,
                    from: from
                });

                return {
                    filePath: tempFile,
                    mimetype: mimetype,
                    caption: imageMessage?.caption || imageMessage?.imageMessage?.caption,
                    base64: base64Image,
                    from: from
                };
            }));

            return downloadedImages;

        } catch (error) {
            console.error('❌ Erro ao baixar imagens do WhatsApp:', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    async analyzeImages(imageMessages) {
        try {
            console.log('🔍 Iniciando análise das imagens...');

            // 1. Download das imagens
            const imagesData = await this.downloadImages(imageMessages);

            // Extrai o remetente do primeiro item
            const from = imagesData[0]?.from;
            if (!from) {
                throw new Error('Remetente não encontrado após download das imagens');
            }

            // 2. Prepara o prompt para análise com OpenAI Vision
            const messages = [{
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Analise estes comprovantes de pagamento e extraia as seguintes informações de cada um:
                            - Valor da transação
                            - Data da transação
                            - Tipo de transação (PIX, transferência, boleto, etc)
                            - Status do pagamento
                            - Informações adicionais relevantes
                            
                            Contexto adicional: ${imagesData[0]?.caption || 'Nenhum'} do remetente ${from}`
                    },
                    ...imagesData.map(imageData => ({
                        type: 'image_url',
                        image_url: {
                            url: `data:${imageData.mimetype};base64,${imageData.base64}`,
                            detail: 'high'
                        }
                    }))
                ]
            }];

            // 3. Envia para análise na OpenAI Vision
            console.log('🤖 Enviando para análise na OpenAI Vision...');
            const response = await this.openaiAxios.post('/chat/completions', {
                model: "gpt-4-vision-preview",
                messages: messages,
                max_tokens: 1000,
                temperature: 0.7
            });

            // 4. Limpa arquivos temporários
            await Promise.all(imagesData.map(async (imageData) => {
                try {
                    await fs.unlink(imageData.filePath);
                    await fs.rmdir(path.dirname(imageData.filePath));
                } catch (error) {
                    console.warn('⚠️ Erro ao limpar arquivos temporários:', error.message);
                }
            }));

            console.log('✅ Análise concluída com sucesso');

            return {
                success: true,
                analysis: response.data.choices[0].message.content,
                metadata: {
                    model: "gpt-4-vision-preview",
                    tokens: response.data.usage,
                    from: from
                }
            };

        } catch (error) {
            console.error('❌ Erro ao analisar imagens:', {
                erro: error.message,
                stack: error.stack
            });
            
            return {
                success: false,
                error: error.message,
                metadata: {
                    model: "gpt-4-vision-preview",
                    from: from
                }
            };
        }
    }

    async processPaymentProof(imageMessages) {
        try {
            console.log('💳 Processando comprovante(s) de pagamento...');

            // 1. Analisa as imagens
            const analysisResult = await this.analyzeImages(imageMessages);

            // 2. Extrai informações do texto da análise
            const paymentInfos = this.extractPaymentInfos(analysisResult.analysis);

            console.log('💰 Informações extraídas:', paymentInfos);

            return paymentInfos;

        } catch (error) {
            console.error('❌ Erro ao processar comprovante(s):', {
                erro: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    extractPaymentInfos(analysisText) {
        // Tenta identificar múltiplos comprovantes no texto
        const sections = analysisText.split(/(?=comprovante|pagamento|transferência|pix|recibo)/i);
        
        return sections.map(section => ({
            isPaymentProof: this.isPaymentProof(section),
            amount: this.extractAmount(section),
            date: this.extractDate(section),
            transactionType: this.extractTransactionType(section),
            status: this.extractStatus(section)
        })).filter(info => info.isPaymentProof); // Filtra apenas os que são realmente comprovantes
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
