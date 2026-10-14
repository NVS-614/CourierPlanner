const Imap = require("imap");
const { simpleParser } = require("mailparser");
const pdf = require("pdf-parse");
const axios = require("axios");
const cron = require("node-cron");
const OpenAI = require("openai");
const https = require("https");
require("dotenv").config();



const openai = new OpenAI({
    apiKey: process.env.AZURE_OPENAI_KEY,
    baseURL: `https://plogisticai.openai.azure.com/openai/deployments/gpt-4.1`,
    defaultQuery: { "api-version": "2024-02-15-preview" }
});

// Allow self-signed certs for POST API
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function cleanText(text) {
    return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

async function extractJsonFromText(docText) {
    const prompt = `
### System:
You are an advanced assistant responsible for extracting and formatting packing slip data. Your output must be valid JSON that follows the structure strictly.

### Instructions:
Return data with these fields:
- "packing_slip_id"
- "order_id"
- "order_date"
- "customer": { "name", "email", "phone" }
- "shipping_address"
- "billing_address"
- "ship_from_address": { "company", "city", "state", "zipcode", "country" }
- "items": [ { "item_id", "description", "quantity" } ]
- "shipping_details": { "carrier", "service", "shipping_method", "tracking_number", "shipping_cost", "total_weight" }
- "total_amount"
- "notes"

Return only valid JSON.
Use "" for missing values.
Join multiline fields with space.
Use strings for all values.
Do NOT include any extra explanation.

### Context:
${docText}

### Response:
Provide the extracted data strictly as a valid JSON object.
`;

    const response = await openai.chat.completions.create({
        model: 'gpt-4.1',
        messages: [
            { role: "system", content: "You are an AI assistant." },
            { role: "user", content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1500
    });

    return response.choices[0].message.content;
}

function processEmails() {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            user: process.env.EMAIL_USER,
            password: process.env.EMAIL_PASS,
            host: "imap.gmail.com",
            port: 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false // <-- accept self-signed certs
            }
        });

        function openInbox(cb) {
            imap.openBox("INBOX", false, cb);
        }

        imap.once("ready", () => {
            openInbox((err, box) => {
                if (err) return reject(err);

                imap.search(["UNSEEN"], (err, results) => {
                    if (err) return reject(err);
                    if (!results.length) {
                        console.log("📭 No unseen emails.");
                        imap.end();
                        return resolve();
                    }

                    const latest = results.slice(-10);
                    const f = imap.fetch(latest, { bodies: "", struct: true });

                    f.on("message", (msg) => {
                        msg.on("body", async (stream) => {
                            try {
                                const parsed = await simpleParser(stream);
                                const attachments = parsed.attachments || [];

                                for (const attachment of attachments) {
                                    if (attachment.filename.toLowerCase().endsWith(".pdf")) {
                                        const data = await pdf(attachment.content);
                                        const pdfText = cleanText(data.text);
                                        const docBase64 = attachment.content.toString("base64");

                                        const aiResponse = await extractJsonFromText(pdfText);
                                        const docJson = JSON.parse(aiResponse);
                                        docJson.RefDoc = docBase64;

                                        const postResponse = await axios.post(
                                            'https://shipv2_xcservices.cfapps.eu10-004.hana.ondemand.com/d2rlist',
                                            docJson,
                                            { httpsAgent }
                                        );

                                        console.log(`✅ Posted JSON for ${attachment.filename} — Status: ${postResponse.status}`);
                                    }
                                }
                            } catch (err) {
                                console.error("❌ Failed processing message:", err.message);
                            }
                        });
                    });

                    f.once("end", () => {
                        imap.end();
                        resolve();
                    });
                });
            });
        });

        imap.once("error", (err) => {
            reject(err);
        });

        imap.connect();
    });
}

// Prevent overlapping runs
let isRunning = false;

// Run every 5 minutes
cron.schedule("*/5 * * * *", async () => {
    if (isRunning) {
        console.warn("⏱️ Job skipped: previous run still in progress.");
        return;
    }

    isRunning = true;
    console.log(`🚀 Job started at ${new Date().toLocaleString()}`);

    try {
        await processEmails();
    } catch (err) {
        console.error("❌ Job error:", err.message);
    }
    isRunning = false;
    console.log(`✅ Job finished at ${new Date().toLocaleString()}`);
});
