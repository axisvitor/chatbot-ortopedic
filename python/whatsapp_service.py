import requests
import json
import time

class WhatsAppService:
    def __init__(self, config):
        self.config = config
        print('Config do WhatsApp:', {
            'apiUrl': self.config['apiUrl'],
            'connectionKey': self.config['connectionKey'][:5] + '...',  # Mostra só os primeiros 5 caracteres
            'whatsappNumber': self.config['whatsappNumber']
        })

    def send_message(self, phone_number, message):
        """Envia mensagem via WhatsApp"""
        try:
            # Adiciona connectionKey como query parameter
            url = f"{self.config['apiUrl']}/message/send-text?connectionKey={self.config['connectionKey']}"
            
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f"Bearer {self.config['token']}"
            }
            
            # Monta o payload conforme a documentação
            data = {
                'phoneNumber': phone_number,
                'text': message,
                'delayMessage': '3'  # 3 segundos
            }

            print('Enviando mensagem com config:', {
                'url': url.split('?')[0] + '?connectionKey=[REDACTED]',  # Esconde os parâmetros sensíveis
                'headers': {
                    'Content-Type': 'application/json',
                    'Authorization': '[REDACTED]'
                },
                'data': data
            })

            response = requests.post(url, headers=headers, json=data)
            response_data = response.json()

            if response_data and response_data.get('error') == False:  # Verifica se error é False
                print(f'Mensagem enviada com sucesso para: {phone_number}')
                print(f'ID da mensagem: {response_data.get("messageId")}')
                # Aguarda o delay configurado
                time.sleep(3)  # 3 segundos
                return True
            else:
                print(f'Erro ao enviar mensagem: {response_data}')
                return False

        except Exception as error:
            print(f'Erro ao enviar mensagem: {str(error)}')
            return False
