const axios = require('axios');

// Per-plant token cache
const upsTokenCache = {};

const fetchAccToken = async (tokenUrl, clientId, clientSecret) => {
	const input = `grant_type=client_credentials`;
 
    const response = await axios.post(tokenUrl, input, {
        headers: {
           'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
                Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        },
    });
    return {
        token: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000) // FIX: was * 999 (typo)
    };
};

const getupsToken = async (tokenUrl, clientId, clientSecret, account) => {
    const cache = upsTokenCache[account];

    if (cache && cache.token && Date.now() < cache.expiresAt) {
        console.log(`Using cached ups token for account ${account}`);
        return cache.token;
    }
    console.log(`Fetching new ups token for account ${account}`);
    const { token, expiresAt } = await fetchAccToken(tokenUrl, clientId, clientSecret);
    upsTokenCache[account] = { token, expiresAt };
    return token;


};



module.exports = { getupsToken };
