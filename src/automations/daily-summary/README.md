# Daily Summary Automation

Esta automação é executada diariamente às 20:00 para verificar pacotes com taxas alfandegárias pendentes e envia um resumo via WhatsApp.

## Funcionalidades
- Busca pacotes com taxas alfandegárias pendentes no 17track
- Gera um resumo categorizado (Taxas Pendentes, Em Alerta, Com Problemas)
- Envia mensagem via WhatsApp com o resumo formatado
- Executa automaticamente todos os dias às 20:00

## Configuração
Configure as seguintes variáveis de ambiente no arquivo `.env`:

```
WAPI_URL=sua_url_aqui
WAPI_TOKEN=seu_token_aqui
WAPI_CONNECTION_KEY=sua_chave_aqui
TECHNICAL_DEPT_NUMBER=seu_numero_aqui
```

## Arquivos
- `customs_summary.py`: Classe principal com a lógica de negócio
- `scheduler.py`: Script para agendar a execução diária
- `test_automation.py`: Script de teste da automação
- `requirements.txt`: Dependências do projeto

## Como Executar
1. Instale as dependências:
```bash
pip install -r requirements.txt
```

2. Para testar a automação:
```bash
python test_automation.py
```

3. Para iniciar o agendador:
```bash
python scheduler.py
```
