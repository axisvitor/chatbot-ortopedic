const moment = require('moment-timezone');
require('moment/locale/pt-br');
const settings = require('../config/settings');

class BusinessHoursService {
    constructor() {
        moment.locale('pt-br');
        this.config = settings.BUSINESS_HOURS;
    }

    getCurrentTime() {
        return moment().tz(this.config.timezone);
    }

    getDayOfWeek() {
        const dayMap = {
            'domingo': 'domingo',
            'segunda-feira': 'segunda',
            'terça-feira': 'terca',
            'quarta-feira': 'quarta',
            'quinta-feira': 'quinta',
            'sexta-feira': 'sexta',
            'sábado': 'sabado'
        };
        const ptDay = this.getCurrentTime().format('dddd');
        return dayMap[ptDay] || ptDay;
    }

    isHoliday() {
        const currentDate = this.getCurrentTime().format('YYYY-MM-DD');
        return this.config.holidays.includes(currentDate);
    }

    isWithinBusinessHours() {
        if (this.isHoliday()) {
            console.log('[BusinessHours] Hoje é feriado');
            return false;
        }

        const now = this.getCurrentTime();
        const day = this.getDayOfWeek();
        const schedule = this.config.schedule[day.toLowerCase()];

        // Se não há horário definido para este dia (ex: domingo)
        if (!schedule?.start || !schedule?.end) {
            console.log('[BusinessHours] Não há expediente hoje');
            return false;
        }

        const [startHour, startMinute] = schedule.start.split(':').map(Number);
        const [endHour, endMinute] = schedule.end.split(':').map(Number);

        const startTime = moment(now).set({ hour: startHour, minute: startMinute, second: 0 });
        const endTime = moment(now).set({ hour: endHour, minute: endMinute, second: 0 });

        const isWithin = now.isBetween(startTime, endTime);
        console.log('[BusinessHours] Verificação de horário:', {
            now: now.format('HH:mm'),
            start: startTime.format('HH:mm'),
            end: endTime.format('HH:mm'),
            isWithin
        });

        return isWithin;
    }

    getNextWorkDay() {
        const now = this.getCurrentTime();
        const weekDays = Object.entries(this.config.schedule);
        const currentDayIndex = weekDays.findIndex(([day]) => day === this.getDayOfWeek().toLowerCase());
        
        // Procura o próximo dia útil
        for (let i = 1; i <= 7; i++) {
            const nextIndex = (currentDayIndex + i) % 7;
            const [day, schedule] = weekDays[nextIndex];
            if (schedule.start) {
                return {
                    name: day.charAt(0).toUpperCase() + day.slice(1),
                    schedule
                };
            }
        }
        
        // Se não encontrar (não deveria acontecer), retorna segunda-feira
        return {
            name: 'Segunda-feira',
            schedule: this.config.schedule.segunda-feira
        };
    }

    getOutOfHoursMessage() {
        const now = this.getCurrentTime();
        const day = this.getDayOfWeek();
        const schedule = this.config.schedule[day.toLowerCase()];

        if (this.isHoliday()) {
            return this.config.messages.holiday;
        }

        if (!schedule?.start) {
            const nextWorkDay = this.getNextWorkDay();
            return this.config.messages.weekend.replace('{NEXT_DAY}', `${nextWorkDay.name} às ${nextWorkDay.schedule.start}`);
        }

        const [startHour] = schedule.start.split(':');
        const [endHour] = schedule.end.split(':');
        return this.config.messages.outsideHours
            .replace('{START_TIME}', `${startHour}h`)
            .replace('{END_TIME}', `${endHour}h`);
    }

    async forwardToFinancial(message, userContact) {
        const forwardData = {
            timestamp: this.getCurrentTime().format(),
            contact: userContact,
            message: message,
            withinBusinessHours: this.isWithinBusinessHours(),
            department: 'financial'
        };

        console.log('[BusinessHours] Encaminhando para financeiro:', forwardData);
        
        // TODO: Implementar envio real
        // await sendEmail(department.email, forwardData);
        // ou
        // await saveToDatabase(forwardData);

        return this.config.messages.financialDepartment;
    }

    getHumanSupportMessage() {
        if (!this.isWithinBusinessHours()) {
            return this.getOutOfHoursMessage();
        }
        return this.config.messages.humanSupport;
    }

    formatBusinessHours() {
        const days = Object.entries(this.config.schedule)
            .filter(([_, schedule]) => schedule?.start && schedule?.end)
            .map(([day, schedule]) => {
                const dayName = day.charAt(0).toUpperCase() + day.slice(1);
                return `${dayName}: ${schedule.start} às ${schedule.end}`;
            })
            .join('\n');

        return `🕒 Horário de Atendimento:\n${days}`;
    }
}

module.exports = { BusinessHoursService };
