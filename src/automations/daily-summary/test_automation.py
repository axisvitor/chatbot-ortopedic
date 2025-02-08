import os
import asyncio
import logging
from dotenv import load_dotenv

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Carregar variáveis de ambiente
load_dotenv()

def get_config():
    """Obtém configuração dos dados de ambiente."""
    config = {
        'endpoint': os.getenv('TRACK17_API_URL'),
        'api_key': os.getenv('TRACK17_API_KEY')
    }
    
    # Valida configurações
    missing = [key for key, value in config.items() if not value]
    if missing:
        raise ValueError(f'Configurações faltando: {", ".join(missing)}')
    
    return config

async def run_test():
    """Executa o teste da automação."""
    try:
        from customs_summary import CustomsSummary
        
        print("\n=== TESTE DA AUTOMAÇÃO DE RESUMO DIÁRIO ===\n")
        
        # Obtém configuração
        config = get_config()
        print("Configuração:", {
            **config,
            'api_key': '***'  # Oculta a chave por segurança
        })
        
        # Cria instância e executa teste
        print("\nIniciando teste...")
        summary = CustomsSummary(config)
        result = await summary.test()
        
        print("\nResultado:", result)
        print("\n=== TESTE CONCLUÍDO COM SUCESSO ===\n")
        
    except Exception as e:
        print("\n=== ERRO NO TESTE ===\n")
        print(f"Tipo do erro: {type(e).__name__}")
        print(f"Mensagem: {str(e)}")
        if hasattr(e, 'response'):
            print(f"Status: {e.response.status_code}")
            print(f"Resposta: {e.response.text}")
        print("\n=========================\n")
        raise

if __name__ == '__main__':
    asyncio.run(run_test())
