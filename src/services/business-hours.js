const moment = require('moment-timezone');
const settings = require('../config/settings');

class BusinessHoursService {
    constructor() {
        this.config = settings.BUSINESS_HOURS;
    }

    getCurrentTime() {
        return moment().tz(this.config.timezone);
    }

    getDayOfWeek() {
        return this.getCurrentTime().format('dddd').toLowerCase();
    }

    isHoliday() {
        const currentDate = this.getCurrentTime().format('YYYY-MM-DD');
        return this.config.holidays.includes(currentDate);
    }

    isWithinBusinessHours() {
        if (this.isHoliday()) {
            return false;
        }

        const now = this.getCurrentTime();
        const day = this.getDayOfWeek();
        const schedule = this.config.schedule[day];

        // Se não há horário definido para este dia (ex: domingo)
        if (!schedule.start || !schedule.end) {
            return false;
        }

        const [startHour, startMinute] = schedule.start.split(':').map(Number);
        const [endHour, endMinute] = schedule.end.split(':').map(Number);

        const startTime = moment(now).set({ hour: startHour, minute: startMinute, second: 0 });
        const endTime = moment(now).set({ hour: endHour, minute: endMinute, second: 0 });

        return now.isBetween(startTime, endTime);
    }

    async forwardToFinancial(message, userContact) {
        // Aqui você implementaria a lógica de encaminhamento
        // Por exemplo, enviando email ou salvando em um banco de dados
        const department = this.config.departments.financial;
        
        // Exemplo de estrutura da mensagem a ser encaminhada
        const forwardData = {
            timestamp: this.getCurrentTime().format(),
            contact: userContact,
            message: message,
            withinBusinessHours: this.isWithinBusinessHours(),
            department: department
        };

        console.log(' Encaminhando para financeiro:', forwardData);
        
        // Aqui você implementaria o envio real
        // await sendEmail(department.email, forwardData);
        // ou
        // await saveToDatabase(forwardData);

        return this.config.autoReply.financialDepartment;
    }

    getHumanSupportMessage() {
        if (!this.isWithinBusinessHours()) {
            return this.config.autoReply.humanSupportNeeded;
        }
        return null; // Durante horário comercial, não precisa de mensagem especial
    }

    formatBusinessHours() {
        const days = Object.entries(this.config.schedule)
            .filter(([_, schedule]) => schedule.start && schedule.end)
            .map(([day, schedule]) => {
                return `${day.charAt(0).toUpperCase() + day.slice(1)}: ${schedule.start} - ${schedule.end}`;
            })
            .join('\n');

        return `Horário de Atendimento Humano:\n${days}`;
    }
}

module.exports = new BusinessHoursService();
