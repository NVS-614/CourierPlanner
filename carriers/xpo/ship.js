// carriers/fedex/ship.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');


const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request) => {
}