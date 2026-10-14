const cron = require('node-cron');
const trackjob = require("./shipmentTracker.js");
// Run the job every 30 minutes
// Prevent overlapping runs
let isRunning = false;
cron.schedule('*/10 * * * *', async () => {
    if (isRunning) {
        console.warn("⏱️ Tracking Job skipped: previous run still in progress.");
        return;
    }
    isRunning = true;
    console.log(`🚀 Tracking Job started at ${new Date().toLocaleString()}`);
    try {
        await trackjob.track_SapCloudTmsDB();
    } catch (error) {
        console.error("❌ Tracking Job error:", err.message);
    }
    isRunning = false;
    console.log('Tracking job completed.');
});
