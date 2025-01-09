import os
from dotenv import load_dotenv
from pathlib import Path

# Carrega o .env da raiz do projeto
project_root = Path(__file__).parent.parent  # volta um nível da pasta python
dotenv_path = project_root / '.env'
load_dotenv(dotenv_path)

def validate_env_var(name):
    """Valida variável de ambiente"""
    value = os.getenv(name)
    if not value:
        raise Exception(f'Environment variable {name} is required')
    return value

# Configurações do WhatsApp
WHATSAPP_CONFIG = {
    'apiUrl': validate_env_var('WAPI_URL'),
    'token': validate_env_var('WAPI_TOKEN'),
    'connectionKey': validate_env_var('WAPI_CONNECTION_KEY'),
    'messageDelay': 3000,  # ajustado para 3 segundos
    'whatsappNumber': os.getenv('WHATSAPP_NUMBER', ''),
    'endpoints': {
        'text': {
            'path': 'message/send-text',
            'method': 'POST',
            'params': {
                'to': 'phoneNumber',
                'content': 'text',
                'delay': 3  # ajustado para 3 segundos
            }
        }
    }
}

# Configurações do 17track
TRACKING_CONFIG = {
    'apiKey': validate_env_var('TRACK17_API_KEY'),
    'endpoint': 'api.17track.net',
    'paths': {
        'register': '/track/v2.2/register',
        'status': '/track/v2.2/gettrackinfo'
    },
    'updateInterval': 3600000,  # 1 hora em ms
    'carriers': ['correios', 'jadlog', 'fedex', 'dhl']
}
