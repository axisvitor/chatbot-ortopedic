# Chatbot Ortopédico com IA

Um chatbot inteligente para atendimento de clientes de uma loja de calçados ortopédicos, com recursos de rastreamento de pedidos e processamento de pagamentos.

## Funcionalidades

- 🤖 Atendimento automatizado usando OpenAI GPT-4
- 🎤 Transcrição de áudio usando Groq
- 🖼️ Análise de imagens para comprovantes de pagamento
- 📦 Rastreamento de pedidos integrado com 17TRACK
- 💬 Integração com WhatsApp API

## Tecnologias

- Node.js 20+
- Express.js
- OpenAI API
- Groq API
- Redis
- WhatsApp API
- 17TRACK API

## Estrutura do Projeto

```
src/
├── config/
│   └── settings.js       # Configurações do projeto
├── services/
│   ├── ai-services.js    # Serviços de IA (OpenAI e Groq)
│   ├── tracking.js       # Serviço de rastreamento
│   └── whatsapp.js       # Serviço do WhatsApp
└── main.js              # Arquivo principal
```

## Configuração

1. Clone o repositório
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Configure as variáveis de ambiente no arquivo `.env`:
   ```env
   OPENAI_API_KEY=sua_chave
   GROQ_API_KEY=sua_chave
   REDIS_HOST=seu_host
   REDIS_PORT=sua_porta
   REDIS_PASSWORD=sua_senha
   TRACK17_API_KEY=sua_chave
   WAPI_URL=sua_url
   WAPI_TOKEN=seu_token
   WAPI_INSTANCE=sua_instancia
   ```

## Uso

Para iniciar o servidor:

```bash
npm start
```

O servidor estará rodando na porta 3000 por padrão.

## Endpoints

- `POST /webhook` - Webhook principal para mensagens do WhatsApp
- `POST /tracking-webhook` - Webhook para atualizações de rastreamento

## Recursos

- Processamento de mensagens de texto, áudio e imagem
- Verificação automática de comprovantes de pagamento
- Notificação automática de atualizações de rastreamento
- Integração com setor financeiro para processamento de pagamentos

## Licença

Este projeto está licenciado sob a MIT License.
