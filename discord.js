// Discord Webhook 消息中转函数
const axios = require("axios")

exports.handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            },
            body: ""
        }
    }

    if (event.httpMethod !== "POST") {
        return {
            statusCode: 405,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "Method not allowed" })
        }
    }

    const webhookUrl = process.env.DISCORD_WEBHOOK_URL

    if (!webhookUrl) {
        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "DISCORD_WEBHOOK_URL is not configured" })
        }
    }

    let payload

    try {
        payload = event.body ? JSON.parse(event.body) : null
    } catch (e) {
        return {
            statusCode: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "Invalid JSON body" })
        }
    }

    if (!payload || typeof payload.content !== "string" || payload.content.trim() === "") {
        return {
            statusCode: 400,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "content is required" })
        }
    }

    try {
        await axios.post(webhookUrl, payload)

        return {
            statusCode: 204,
            headers: {
                "Access-Control-Allow-Origin": "*"
            },
            body: ""
        }
    } catch (err) {
        return {
            statusCode: 502,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "Failed to send to Discord" })
        }
    }
}

