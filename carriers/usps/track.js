const axios = require('axios');
const moment = require('moment');
const reuse = require('../../Reuse/utilityfunctions.js');
const trackuse = require("../../SAPTRACK/trackUtilities.js");
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
require('dotenv').config();

module.exports = async (request) => {

    const TRACK_RESPONSES = [];

   
};

async function promisePool(tasks, poolSize = 5) {

    const results = [];
    const executing = [];

    for (const task of tasks) {

        const p = Promise.resolve().then(() => task());
        results.push(p);

        if (poolSize <= tasks.length) {

            const e = p.then(() =>
                executing.splice(executing.indexOf(e), 1)
            );

            executing.push(e);

            if (executing.length >= poolSize) {
                await Promise.race(executing);
            }
        }
    }

    return Promise.all(results);
}