const customsSummary = require('./customs-summary');

// Start the daily summary scheduler
customsSummary.startScheduler();

module.exports = customsSummary;
