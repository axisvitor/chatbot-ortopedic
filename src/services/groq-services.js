const axios = require('axios');
const fs = require('fs').promises;
const FormData = require('form-data');
const settings = require('../config/settings');

class GroqServices {
    constructor() {
        this.models = settings.GROQ_CONFIG.models;
        this.axiosInstance = axios.create({
            headers: {
                'Authorization': `Bearer ${settings.GROQ_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async analyzeImage(imageData) {
        try {
            // Validação inicial
            if (!imageData) {
                throw new Error('Dados da imagem não fornecidos');
            }

            let buffer;
            let base64Data;
            let detectedFormat;

            // Se for uma string base64 ou data URL
            if (typeof imageData === 'string') {
                // Remove espaços em branco e quebras de linha
                const cleanedData = imageData.trim().replace(/[\n\r]/g, '');
                
                // Verifica se é uma data URL
                if (cleanedData.startsWith('data:')) {
                    const dataUrlMatch = cleanedData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
                    if (!dataUrlMatch) {
                        throw new Error('Formato de data URL inválido');
                    }
                    base64Data = dataUrlMatch[2];
                    detectedFormat = `image/${dataUrlMatch[1]}`;
                } else {
                    // Assume que é base64 puro
                    base64Data = cleanedData;
                }

                // Converte para buffer
                try {
                    buffer = Buffer.from(base64Data, 'base64');
                } catch (e) {
                    console.error('❌ Erro ao converter base64:', e);
                    throw new Error('Base64 inválido: não foi possível converter para buffer');
                }
            }
            // Se já for um Buffer
            else if (Buffer.isBuffer(imageData)) {
                buffer = imageData;
                base64Data = buffer.toString('base64');
            }
            else {
                throw new Error('Formato de imagem inválido. Esperado: Buffer ou string base64');
            }

            // Validação do buffer
            if (!buffer || buffer.length < 8) {
                throw new Error('Buffer de imagem inválido ou muito pequeno');
            }

            // Verifica o tamanho do buffer
            const sizeInMB = buffer.length / (1024 * 1024);
            if (sizeInMB > 4) {
                throw new Error('Imagem muito grande. O limite máximo é 4MB');
            }

            // Magic numbers atualizados para detecção de formato
            const magicNumbers = {
                'FFD8FF': 'image/jpeg',    // JPEG (todos os tipos)
                '89504E47': 'image/png',   // PNG
                '47494638': 'image/gif',   // GIF
                '52494646': 'image/webp',  // WEBP
                '49492A00': 'image/tiff',  // TIFF
                '4D4D002A': 'image/tiff'   // TIFF (big endian)
            };

            // Se o formato ainda não foi detectado via data URL, tenta pelos magic numbers
            if (!detectedFormat) {
                const fileHeader = buffer.slice(0, 4).toString('hex').toUpperCase();
                
                console.log('🔍 Analisando cabeçalho da imagem:', {
                    header: fileHeader,
                    bufferLength: buffer.length,
                    firstBytes: buffer.slice(0, 16).toString('hex').toUpperCase()
                });
                
                for (const [magic, format] of Object.entries(magicNumbers)) {
                    if (fileHeader.startsWith(magic)) {
                        detectedFormat = format;
                        break;
                    }
                }

                if (!detectedFormat && fileHeader.startsWith('FFD8')) {
                    detectedFormat = 'image/jpeg';
                }
            }

            if (!detectedFormat) {
                throw new Error('Formato de imagem não reconhecido');
            }

            // Log detalhado antes de enviar para análise
            console.log('[Groq] Enviando imagem para análise:', {
                format: detectedFormat,
                bufferSize: buffer.length,
                base64Length: base64Data.length,
                isValidBuffer: Buffer.isBuffer(buffer),
                firstBytes: buffer.slice(0, 16).toString('hex').toUpperCase()
            });

            // Prepara os dados para envio
            const requestData = {
                model: this.models.vision,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${detectedFormat};base64,${base64Data}`
                                }
                            },
                            {
                                type: 'text',
                                text: 'Analise esta imagem e me diga se é um comprovante de pagamento válido. Se for, extraia as informações relevantes como valor, data, beneficiário e tipo de transação.'
                            }
                        ]
                    }
                ]
            };

            const response = await this.axiosInstance.post('https://api.groq.com/v1/chat/completions', requestData);
            return response.data.choices[0].message.content;

        } catch (error) {
            console.error('[Groq] Erro ao analisar imagem:', error);
            throw error;
        }
    }

    async transcribeAudio(audioBuffer, mimeType) {
        try {
            if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
                throw new Error('Áudio inválido: buffer não fornecido ou inválido');
            }

            if (!mimeType || typeof mimeType !== 'string') {
                throw new Error('Tipo MIME do áudio não fornecido');
            }

            // Converte o buffer para base64
            const base64Audio = audioBuffer.toString('base64');

            // Log do áudio
            console.log('[Groq] Preparando áudio para transcrição:', {
                bufferSize: audioBuffer.length,
                mimeType,
                base64Length: base64Audio.length
            });

            // Prepara os dados para envio
            const requestData = {
                model: this.models.transcription,
                file: `data:${mimeType};base64,${base64Audio}`,
                language: 'pt'
            };

            const response = await this.axiosInstance.post('https://api.groq.com/v1/audio/transcriptions', requestData);
            return response.data.text;

        } catch (error) {
            console.error('[Groq] Erro ao transcrever áudio:', error);
            throw error;
        }
    }
}

module.exports = { GroqServices };
