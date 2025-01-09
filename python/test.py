#!/usr/bin/env python
# -*- coding: utf-8 -*-
import sys
import json
from tracking_service import TrackingService
from whatsapp_service import WhatsAppService

# Força o encoding para UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

def test_daily_summary():
    print("Iniciando teste do resumo diário...")
    
    # Carrega configuração do WhatsApp
    with open('config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
        whatsapp_config = config['whatsapp']
        print("Config do WhatsApp:", {**whatsapp_config, 'connectionKey': 'w-api...'})
    
    try:
        print("Gerando resumo diário de taxas...")
        tracking_service = TrackingService()
        packages = tracking_service.get_packages_with_pending_customs()
        
        if not packages:
            print("Nenhum pacote com taxa pendente encontrado.")
            return
        
        # Formata a mensagem
        message = "*📦 Resumo Diário - Taxas Pendentes*\n\n"
        for package in packages:
            message += f"*Rastreio:* {package['tracking_number']}\n"
            message += f"*Status:* {package['status']}\n"
            if 'latest_event' in package:
                message += f"*Último evento:* {package['latest_event']}\n"
            if 'shipping_country' in package and 'recipient_country' in package:
                message += f"*Rota:* {package['shipping_country']} → {package['recipient_country']}\n"
            if 'days_in_transit' in package:
                message += f"*Dias em trânsito:* {package['days_in_transit']}\n"
            if 'days_since_update' in package:
                message += f"*Dias desde atualização:* {package['days_since_update']}\n"
            message += "\n"
        
        # Envia a mensagem
        whatsapp = WhatsAppService(whatsapp_config)
        whatsapp.send_message(whatsapp_config['whatsappNumber'], message)
        
    except Exception as error:
        print(f"Erro ao gerar resumo diário: {str(error)}")
        whatsapp = WhatsAppService(whatsapp_config)
        whatsapp.send_message(
            whatsapp_config['whatsappNumber'], 
            "Erro ao gerar resumo diário de taxas pendentes. Por favor, verifique o sistema."
        )
    
    print("Teste concluído!")

if __name__ == "__main__":
    test_daily_summary()
