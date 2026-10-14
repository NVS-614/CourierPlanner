const axios = require('axios');

// Per-plant token cache
const fedexTokenCache = {};
const fedexTrackTokenCache = {};

// Generalized token fetcher
const fetchToken = async (tokenUrl, clientId, clientSecret) => {
    const input = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
    const response = await axios.post(tokenUrl, input, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
    });
    return {
        token: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
    };
};

const getFedexToken = async (straccount, tokenUrl, clientId, clientSecret) => {
    const cache = fedexTokenCache[straccount];

    if (cache && cache.token && Date.now() < cache.expiresAt) {
        console.log(`Using cached FEDEX token for plant ${straccount}`);
        return cache.token;
    }

    console.log(`Fetching new FEDEX token for plant ${straccount}`);
    const { token, expiresAt } = await fetchToken(tokenUrl, clientId, clientSecret);
    fedexTokenCache[straccount] = { token, expiresAt };
    return token;
};

const getFedexTrackToken = async (straccount, tokenUrl, clientId, clientSecret) => {
    const cache = fedexTrackTokenCache[straccount];

    if (cache && cache.token && Date.now() < cache.expiresAt) {
        console.log(`Using cached FEDEX tracking token for plant ${straccount}`);
        return cache.token;
    }

    console.log(`Fetching new FEDEX tracking token for plant ${straccount}`);
    const { token, expiresAt } = await fetchToken(tokenUrl, clientId, clientSecret);
    fedexTrackTokenCache[straccount] = { token, expiresAt };
    return token;
};

module.exports = { getFedexToken, getFedexTrackToken };
