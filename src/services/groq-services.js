const axios = require('axios');
const FormData = require('form-data');
const { detectImageFormatFromBuffer } = require('../utils/image-format');
const { GROQ_CONFIG } = require('../config/settings');

class GroqServices {
    constructor() {
        this.axiosInstance = axios.create({
            headers: {
                'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
    }

    /**
     * Analisa uma imagem usando IA
     * @param {Buffer|string} imageData - Buffer da imagem ou URL
     * @returns {Promise<string>} Resultado da análise
     */
    async analyzeImage(imageData) {
        let attempt = 0;
        let lastError;

        while (attempt < 3) {
            try {
                const { format, base64 } = await this.prepareImageData(imageData);

                console.log('[Groq] Enviando imagem para análise:', {
                    format,
                    base64Length: base64.length,
                    attempt: attempt + 1
                });

                const requestData = {
                    model: "llama-3.2-90b-vision-preview",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Analise esta imagem com foco em problemas ortopédicos. Se identificar algum problema, forneça uma análise detalhada e orientações iniciais. Se não identificar problemas, descreva o que vê na imagem."
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:${format};base64,${base64}`
                                    }
                                }
                            ]
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1024,
                    top_p: 1,
                    stream: false
                };

                const response = await this.axiosInstance.post(
                    'https://api.groq.com/v1/chat/completions',
                    requestData
                );

                if (!response?.data?.choices?.[0]?.message?.content) {
                    throw new Error('Resposta inválida da API');
                }

                return response.data.choices[0].message.content;

            } catch (error) {
                console.error(`[Groq] Erro na tentativa ${attempt + 1}:`, {
                    message: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });

                lastError = error;
                attempt++;

                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        throw new Error(`Falha ao analisar imagem após ${attempt} tentativas: ${lastError.message}`);
    }

    /**
     * Prepara os dados da imagem para envio
     * @param {Buffer|string} imageData - Buffer da imagem ou URL
     * @returns {Promise<Object>} Formato e base64 da imagem
     */
    async prepareImageData(imageData) {
        let buffer;
        
        // Log inicial dos dados recebidos
        console.log('[Groq] Preparando dados da imagem:', {
            type: typeof imageData,
            isBuffer: Buffer.isBuffer(imageData),
            length: imageData?.length,
            isString: typeof imageData === 'string',
            startsWithHttp: typeof imageData === 'string' && imageData.startsWith('http')
        });

        // Converte para Buffer se necessário
        if (typeof imageData === 'string') {
            // Se for uma URL, faz o download
            if (imageData.startsWith('http')) {
                try {
                    const response = await axios({
                        method: 'GET',
                        url: imageData,
                        responseType: 'arraybuffer',
                        timeout: 10000,
                        maxContentLength: 10 * 1024 * 1024 // 10MB
                    });
                    buffer = Buffer.from(response.data);
                } catch (error) {
                    throw new Error(`Falha ao baixar imagem: ${error.message}`);
                }
            } 
            // Se for uma data URL
            else if (imageData.startsWith('data:')) {
                const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                    buffer = Buffer.from(matches[2], 'base64');
                } else {
                    throw new Error('Data URL inválida');
                }
            } 
            // Se for base64 puro
            else {
                try {
                    buffer = Buffer.from(imageData, 'base64');
                } catch (error) {
                    throw new Error('String base64 inválida');
                }
            }
        } else if (Buffer.isBuffer(imageData)) {
            buffer = imageData;
        } else {
            throw new Error('Dados inválidos: esperado Buffer, URL ou string base64');
        }

        // Validação do buffer
        if (!buffer || buffer.length < 8) {
            throw new Error('Buffer inválido ou muito pequeno');
        }

        // Log do buffer para debug
        console.log('[Groq] Buffer recebido:', {
            length: buffer.length,
            firstBytes: buffer.slice(0, 32).toString('hex').toUpperCase(),
            isJPEG: buffer.slice(0, 2).toString('hex').toUpperCase() === 'FFD8',
            isPNG: buffer.slice(0, 8).toString('hex').toUpperCase().includes('89504E47')
        });

        // Detecta o formato
        const detectedFormat = detectImageFormatFromBuffer(buffer);
        if (!detectedFormat) {
            throw new Error('Formato de imagem não reconhecido');
        }

        // Converte para base64
        const base64Data = buffer.toString('base64');

        return {
            format: detectedFormat,
            base64: base64Data,
            buffer
        };
    }

    /**
     * Processa áudio do WhatsApp
     * @param {Object} messageData - Dados da mensagem
     * @returns {Promise<string>} Texto transcrito
     */
    async processWhatsAppAudio(messageData) {
        try {
            if (!messageData?.audioMessage) {
                throw new Error('Campos obrigatórios ausentes no áudio');
            }

            console.log('[Groq] Processando áudio do WhatsApp:', {
                mimetype: messageData.audioMessage.mimetype,
                seconds: messageData.audioMessage.seconds,
                hasStream: !!messageData.audioMessage.stream
            });

            // Verifica o tamanho do áudio
            const maxDuration = 300; // 5 minutos
            if (messageData.audioMessage.seconds > maxDuration) {
                throw new Error('Áudio muito grande para processamento');
            }

            // Obtém o stream do áudio
            const audioStream = await messageData.audioMessage.stream();
            if (!audioStream) {
                throw new Error('Stream de áudio não gerado');
            }

            // Prepara o FormData para envio
            const formData = new FormData();
            formData.append('file', audioStream, {
                filename: 'audio.ogg',
                contentType: messageData.audioMessage.mimetype
            });
            formData.append('model', GROQ_CONFIG.models.audio);
            formData.append('language', GROQ_CONFIG.audioConfig.language);
            formData.append('response_format', GROQ_CONFIG.audioConfig.response_format);
            formData.append('temperature', GROQ_CONFIG.audioConfig.temperature);

            // Faz a requisição para a API
            const response = await axios.post(
                'https://api.groq.com/v1/audio/transcriptions',
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                        'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                    },
                    timeout: 60000 // 1 minuto
                }
            );

            if (!response?.data?.text) {
                throw new Error('Resposta da API não contém texto transcrito');
            }

            return response.data.text;

        } catch (error) {
            console.error('[Groq] Erro ao processar áudio:', error);
            throw error;
        }
    }

    /**
     * Transcreve um arquivo de áudio
     * @param {FormData} formData - FormData contendo o arquivo de áudio e configurações
     * @returns {Promise<string>} Texto transcrito
     */
    async transcribeAudio(formData) {
        let attempt = 0;
        let lastError;

        while (attempt < 3) {
            try {
                console.log('[Groq] Enviando áudio para transcrição (tentativa ' + (attempt + 1) + ')');

                const response = await axios.post(
                    'https://api.groq.com/openai/v1/audio/transcriptions',
                    formData,
                    {
                        headers: {
                            ...formData.getHeaders(),
                            'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`
                        },
                        timeout: 60000 // 60 segundos para arquivos grandes
                    }
                );

                if (!response?.data?.text) {
                    throw new Error('Resposta inválida da API de transcrição');
                }

                console.log('[Groq] Transcrição concluída:', {
                    length: response.data.text.length,
                    preview: response.data.text.substring(0, 100)
                });

                return response.data.text;

            } catch (error) {
                console.error(`[Groq] Erro na tentativa ${attempt + 1} de transcrição:`, {
                    message: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });

                lastError = error;
                attempt++;

                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        throw new Error(`Falha ao transcrever áudio após ${attempt} tentativas: ${lastError.message}`);
    }

    /**
     * Faz uma chamada para o modelo de chat
     * @param {Array} messages - Lista de mensagens no formato {role, content}
     * @returns {Promise<string>} Resposta do modelo
     */
    async chat(messages) {
        let attempt = 0;
        let lastError;

        while (attempt < 3) {
            try {
                console.log('[Groq] Enviando mensagem para chat:', {
                    messageCount: messages.length,
                    lastMessage: messages[messages.length - 1].content.substring(0, 100),
                    attempt: attempt + 1
                });

                const response = await this.axiosInstance.post(
                    'https://api.groq.com/v1/chat/completions',
                    {
                        model: GROQ_CONFIG.models.chat,
                        messages,
                        temperature: 0.7,
                        max_tokens: 1000
                    }
                );

                if (!response?.data?.choices?.[0]?.message?.content) {
                    throw new Error('Resposta inválida da API de chat');
                }

                const content = response.data.choices[0].message.content.trim();

                console.log('[Groq] Resposta recebida:', {
                    length: content.length,
                    preview: content.substring(0, 100)
                });

                return content;

            } catch (error) {
                console.error(`[Groq] Erro na tentativa ${attempt + 1} de chat:`, {
                    message: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });

                lastError = error;
                attempt++;

                if (attempt < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        throw new Error(`Falha ao processar chat após ${attempt} tentativas: ${lastError.message}`);
    }
}

module.exports = { GroqServices };
