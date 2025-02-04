import requests
import json
from datetime import datetime

# Configuração
API_KEY = 'B98966348453793271B4F98DF05638E0'
BASE_URL = 'https://api.17track.net'
TRACKING_NUMBER = 'NM699016098BR'  # Número de rastreio para teste

def test_tracking_status():
    """
    Testa a busca de status de rastreamento usando detecção automática de transportadora
    """
    endpoint = f'{BASE_URL}/track/v2.2/gettrackinfo'
    headers = {
        '17token': API_KEY,
        'Content-Type': 'application/json'
    }

    # Dados da requisição - apenas o número, sem especificar transportadora
    data = [
        {
            "number": TRACKING_NUMBER
        }
    ]

    try:
        print(f"\n🔍 Testando rastreio: {TRACKING_NUMBER}")
        print(f"📡 URL: {endpoint}")
        
        response = requests.post(endpoint, headers=headers, json=data)
        
        print(f"\n📊 Status Code: {response.status_code}")
        print(f"🔤 Content-Type: {response.headers.get('content-type')}")
        
        if response.headers.get('content-type', '').startswith('application/json'):
            result = response.json()
            print("\n📦 Resposta formatada:")
            print(json.dumps(result, indent=2, ensure_ascii=False))
            
            if result.get('code') != 0:
                print(f"\n❌ Erro: {result.get('message', 'Erro desconhecido')}")
            else:
                print("\n✅ Requisição bem sucedida!")
                
                # Se tiver dados aceitos, mostra a transportadora detectada
                if result.get('data', {}).get('accepted'):
                    for track in result['data']['accepted']:
                        print(f"\n🚚 Transportadora detectada: {track.get('carrier', 'Não informado')}")
                        
    except requests.exceptions.RequestException as e:
        print(f"\n❌ Erro na requisição: {str(e)}")
    except json.JSONDecodeError as e:
        print(f"\n❌ Erro ao decodificar JSON: {str(e)}")
    except Exception as e:
        print(f"\n❌ Erro inesperado: {str(e)}")

if __name__ == '__main__':
    print("🚀 Iniciando teste do 17track API...")
    print(f"⏰ Data/Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    test_tracking_status()
