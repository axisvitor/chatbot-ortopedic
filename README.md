# Chatbot Ortopédico - Sistema de Rastreamento

Sistema automatizado para rastreamento de pacotes e envio de notificações via WhatsApp.

## Funcionalidades

- Rastreamento automático de pacotes via API 17track
- Detecção de pacotes com:
  - Taxas pendentes/retenção alfandegária
  - Status de alerta
  - Problemas de entrega
- Envio de resumos diários via WhatsApp
- Integração com Nuvemshop para gerenciamento de pedidos

## Configuração

1. Clone o repositório:
```bash
git clone https://github.com/axisvitor/chatbot-ortopedic.git
cd chatbot-ortopedic
```

2. Instale as dependências:
```bash
npm install
pip install -r requirements.txt
```

3. Configure as variáveis de ambiente:
- Copie `.env.example` para `.env`
- Preencha as variáveis necessárias:
  - `TRACK17_API_URL`: URL da API 17track
  - `TRACK17_API_KEY`: Chave da API 17track
  - `WAPI_URL`: URL da API WhatsApp
  - `WAPI_TOKEN`: Token da API WhatsApp
  - `WAPI_CONNECTION_KEY`: Chave de conexão WhatsApp
  - `TECHNICAL_DEPT_NUMBER`: Número para notificações técnicas

## Estrutura do Projeto

```
src/
├── automations/          # Automações e tarefas agendadas
│   └── daily-summary/    # Resumo diário de pacotes
├── tracking-system/      # Sistema de rastreamento
│   └── services/        # Serviços de integração
└── services/            # Outros serviços (Nuvemshop, etc)
```

## Deploy

O projeto está configurado para deploy no Railway:

1. Configure as variáveis de ambiente no Railway
2. Conecte seu repositório GitHub
3. O Railway detectará automaticamente a configuração

## Desenvolvimento

Para rodar localmente:
```bash
npm run dev
```

Para executar as automações:
```bash
npm run automation
```

## Licença

Este projeto está licenciado sob a MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.
