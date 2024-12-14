const fs = require('fs');
const { existsSync } = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

class AudioService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.tempDir = path.join(__dirname, '../../temp');
    }

    async processWhatsAppAudio(messageData) {
        try {
            console.log('📩 Processando áudio do WhatsApp:', {
                temMensagem: !!messageData,
                temAudio: !!messageData?.audioMessage,
                campos: messageData?.audioMessage ? Object.keys(messageData.audioMessage) : [],
                temBuffer: !!messageData?.audioMessage?.buffer,
                temUrl: !!messageData?.audioMessage?.url
            });

            const audioMessage = messageData?.audioMessage;
            if (!audioMessage) {
                throw new Error('Dados do áudio ausentes ou inválidos');
            }

            let audioBuffer = audioMessage.buffer;

            // Se não tiver buffer mas tiver URL, tenta baixar
            if (!audioBuffer && audioMessage.url) {
                console.log('🔄 Buffer não encontrado, tentando download da URL...');
                try {
                    const response = await axios.get(audioMessage.url, {
                        responseType: 'arraybuffer',
                        headers: {
                            'Authorization': `Bearer ${process.env.WHATSAPP_API_KEY}`
                        }
                    });
                    audioBuffer = Buffer.from(response.data);
                    console.log('✅ Download concluído:', {
                        tamanhoBuffer: audioBuffer.length
                    });
                } catch (downloadError) {
                    throw new Error('Falha ao baixar áudio: ' + downloadError.message);
                }
            }

            if (!audioBuffer || !audioBuffer.length) {
                throw new Error('Dados binários do áudio não encontrados');
            }

            // Prepara o FormData para envio
            const formData = new FormData();
            formData.append('file', audioBuffer, {
                filename: 'audio.ogg',
                contentType: audioMessage.mimetype
            });
            formData.append('model', 'whisper-1');
            formData.append('language', 'pt');

            // Transcreve o áudio usando Groq
            const transcription = await this.groqServices.transcribeAudio(formData);
            console.log('✅ Transcrição concluída:', transcription);
            
            return transcription;

        } catch (error) {
            console.error('❌ Erro ao processar áudio:', error);
            throw error;
        }
    }

    _isValidAudioMimeType(mimetype) {
        const validMimeTypes = [
            'audio/ogg',
            'audio/ogg; codecs=opus',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/wave',
            'audio/webm',
            'audio/aac'
        ];
        return validMimeTypes.some(valid => mimetype?.toLowerCase().startsWith(valid));
    }
}

module.exports = { AudioService };
