import requests
import json
from dotenv import load_dotenv
import os

# Carrega variáveis de ambiente
load_dotenv()

# Configurações da API
API_URL = "https://api6.serverapi.dev"
API_KEY = "earMDgEWpQtY9Vz8oM6KxNrhFba6wRY0e"
CONNECTION_KEY = "w-api_meLKNuXHUl"
FINANCIAL_NUMBER = "5577981678577"

def test_endpoint(method, endpoint, params=None, data=None):
    """
    Testa um endpoint específico da API
    """
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {API_KEY}'
    }

    # Adiciona connectionKey como query parameter
    url = f"{API_URL}/{endpoint}"
    if "?" not in url:
        url += f"?connectionKey={CONNECTION_KEY}"
    else:
        url += f"&connectionKey={CONNECTION_KEY}"

    print(f"\n=== Testando {method} {endpoint} ===")
    print(f"URL: {url}")
    print(f"Headers: {json.dumps(headers, indent=2)}")
    if data:
        print(f"Data: {json.dumps(data, indent=2)}")

    try:
        if method == "GET":
            response = requests.get(url, headers=headers, params=params)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=data)

        print(f"\nStatus Code: {response.status_code}")
        print(f"Response: {json.dumps(response.json() if response.text else {}, indent=2)}")

    except Exception as e:
        print(f"\nErro na requisição: {str(e)}")

    print("=" * 50)

def test_all_endpoints():
    """
    Testa todos os endpoints principais da W-API
    """
    # 1. Teste de status da conexão
    test_endpoint("GET", "instance/info")

    # 2. Teste de envio de mensagem de texto
    test_endpoint("POST", "message/sendText", data={
        "phoneNumber": FINANCIAL_NUMBER,
        "message": "Teste de mensagem via API",
        "delayMessage": "1000"
    })

    # 3. Teste de envio de imagem
    test_endpoint("POST", "message/sendImage", data={
        "phoneNumber": FINANCIAL_NUMBER,
        "image": "https://example.com/image.jpg",
        "caption": "Teste de imagem"
    })

    # 4. Teste de envio de documento
    test_endpoint("POST", "message/sendDocument", data={
        "phoneNumber": FINANCIAL_NUMBER,
        "document": "https://example.com/doc.pdf",
        "fileName": "teste.pdf"
    })

    # 5. Teste de envio de áudio
    test_endpoint("POST", "message/sendAudio", data={
        "phoneNumber": FINANCIAL_NUMBER,
        "audio": "https://example.com/audio.mp3"
    })

    # 6. Teste de status do webhook
    test_endpoint("GET", "webhook/status")

if __name__ == "__main__":
    print("Iniciando testes dos endpoints da W-API...")
    test_all_endpoints()
