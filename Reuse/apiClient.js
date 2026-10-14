// FIX: Removed unused `express` and `router` imports — this is a plain utility, not a route file.
const axios = require('axios');

/**
 * A reusable function to handle API requests with Axios.
 *
 * @param {string} method - The HTTP method ('GET', 'POST', etc.).
 * @param {string} url - The API endpoint.
 * @param {object} options - The options object with configurations.
 * @param {object} [options.headers] - Headers for the request.
 * @param {object} [options.queryParams] - Query parameters.
 * @param {object} [options.payload] - Payload for POST/PUT requests.
 * @param {string} [options.authType] - Authentication type ('Bearer' | 'Basic'). Applied automatically when token is provided.
 * @param {string} [options.token] - Token / credential string for authentication.
 * @param {string} [options.apiKey] - API key added as X-Api-Key header.
 *
 * @returns {Promise<object>} - The response data.
 */
async function apiRequest(method, url, options = {}) {
    try {
        const {
            headers = {},
            queryParams = {},
            payload = null,
            authType = null,
            token = null,
            apiKey = null
        } = options;

        // FIX: authType/token were accepted but silently ignored — now applied to headers.
        const authHeaders = {};
        if (token) {
            authHeaders['Authorization'] = authType === 'Basic'
                ? `Basic ${token}`
                : `Bearer ${token}`;
        }
        if (apiKey) {
            authHeaders['X-Api-Key'] = apiKey;
        }

        const config = {
            method,
            url,
            headers: { ...headers, ...authHeaders },
            params: queryParams,
            data: payload
        };

        const response = await axios(config);
        return response.data;
    } catch (error) {
        if (error.response) {
            console.error('API Error Response:', JSON.stringify(error.response?.data));
            throw new Error(JSON.stringify(error.response?.data));
        } else if (error.request) {
            console.error('No Response from server:', url);
            throw new Error('No response from the server');
        } else {
            console.error('API Request Error:', error.message);
            throw new Error(error.message);
        }
    }
}

module.exports = apiRequest;
