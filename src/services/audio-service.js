const axios = require('axios');
const path = require('path');
const FormData = require('form-data');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const fs = require('fs').promises;

class AudioService {
    constructor(groqServices) {
        this.groqServices = groqServices;
        this.tempDir = path.join(__dirname, '../../temp');
    }

    async processWhatsAppAudio(messageData) {
        let tempFiles = [];
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

            // Verifica o tipo MIME
            if (!this._isValidAudioMimeType(audioMessage.mimetype)) {
                throw new Error(`Formato de áudio não suportado: ${audioMessage.mimetype}`);
            }

            // Cria diretório temporário se não existir
            await fs.mkdir(this.tempDir, { recursive: true });

            // Salva o buffer em um arquivo temporário
            const inputPath = path.join(this.tempDir, `input_${Date.now()}.ogg`);
            const outputPath = path.join(this.tempDir, `output_${Date.now()}.wav`);
            tempFiles.push(inputPath, outputPath);

            await fs.writeFile(inputPath, audioBuffer);
            console.log('✅ Áudio salvo temporariamente:', inputPath);

            // Converte o áudio para WAV com melhor qualidade
            await this._convertAudio(inputPath, outputPath);
            console.log('✅ Áudio convertido:', outputPath);

            // Lê o arquivo convertido
            const processedAudio = await fs.readFile(outputPath);

            // Prepara o FormData para envio
            const formData = new FormData();
            formData.append('file', processedAudio, {
                filename: 'audio.wav',
                contentType: 'audio/wav'
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
        } finally {
            // Limpa arquivos temporários
            for (const file of tempFiles) {
                try {
                    await fs.unlink(file);
                    console.log('🗑️ Arquivo temporário removido:', file);
                } catch (err) {
                    console.error('⚠️ Erro ao remover arquivo temporário:', err);
                }
            }
        }
    }

    async _convertAudio(inputPath, outputPath) {
        return new Promise((resolve, reject) => {
            console.log('🔄 Iniciando conversão de áudio:', {
                entrada: inputPath,
                saida: outputPath
            });

            const ffmpegProcess = spawn(ffmpeg, [
                '-i', inputPath,
                '-acodec', 'pcm_s16le',  // Codec WAV de 16-bit
                '-ar', '16000',          // Sample rate de 16kHz
                '-ac', '1',              // Mono channel
                '-y',                    // Sobrescrever arquivo se existir
                outputPath
            ]);

            ffmpegProcess.stderr.on('data', (data) => {
                console.log('🎵 FFmpeg:', data.toString());
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Conversão concluída com sucesso');
                    resolve();
                } else {
                    console.error('❌ Erro na conversão:', code);
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpegProcess.on('error', (err) => {
                console.error('❌ Erro no processo FFmpeg:', err);
                reject(err);
            });
        });
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
