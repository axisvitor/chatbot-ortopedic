import { CustomsSummary } from './customs-summary.js';
import { TRACKING_CONFIG, WHATSAPP_CONFIG } from '../../config/settings.js';

const customsSummary = new CustomsSummary({
    ...TRACKING_CONFIG,
    whatsappNumber: WHATSAPP_CONFIG.whatsappNumber
});

// Start the daily summary scheduler
await customsSummary.startScheduler();

export default customsSummary;
