const axios = require("axios")
const crypto = require("crypto")

const MAX_DINGTALK_TEXT_LENGTH = 15000

let isReporterStarted = false
let reportTimer = null
let lastReportAtMs = Date.now()
let countsByPlaceKey = new Map()

function toInt(value) {
    const n = Number.parseInt(String(value), 10)
    return Number.isFinite(n) ? n : null
}

function clipText(text, maxLen) {
    if (typeof text !== "string") return ""
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen - 3) + "..."
}

function parseDiscordContent(rawContent) {
    const text = typeof rawContent === "string" ? rawContent : ""

    const placeIdMatch = text.match(/PlaceId:\s*([0-9]+)/i)
    const placeId = placeIdMatch ? toInt(placeIdMatch[1]) : null

    const placeNameMatch = text.match(/PlaceName:\s*([^|]+?)(?:\s*\||\s*$)/i)
    const placeName = placeNameMatch ? placeNameMatch[1].trim() : null

    const feedbackMatch = text.match(/📝\s*Feedback:\s*[\r\n]+\s*"([\s\S]*?)"\s*(?:[\r\n]+👤|$)/)
    const feedback = feedbackMatch ? feedbackMatch[1].trim() : null

    const headerMatch = text.match(/^\s*\[([^\]]+)\]\s*-\s*(.+?)\s*$/m)
    const header = headerMatch ? headerMatch[1].trim() : null
    const playerDisplayName = headerMatch ? headerMatch[2].trim() : null

    return {
        rawContent: text,
        placeId,
        placeName,
        feedback,
        header,
        playerDisplayName
    }
}

function getPlaceKey(placeId, placeName) {
    const idPart = placeId != null ? String(placeId) : "UnknownPlaceId"
    const namePart = placeName ? placeName : "UnknownPlaceName"
    return `${idPart} (${namePart})`
}

function addCount(placeId, placeName) {
    const key = getPlaceKey(placeId, placeName)
    const current = countsByPlaceKey.get(key) || 0
    countsByPlaceKey.set(key, current + 1)
}

function buildDingTalkWebhookUrl(baseWebhookUrl) {
    const webhookUrl = typeof baseWebhookUrl === "string" ? baseWebhookUrl.trim() : ""
    if (!webhookUrl) return ""

    const secret = process.env.DINGTALK_SECRET
    if (!secret) return webhookUrl

    const timestamp = Date.now()
    const stringToSign = `${timestamp}\n${secret}`
    const sign = encodeURIComponent(
        crypto.createHmac("sha256", secret).update(stringToSign).digest("base64")
    )

    const joiner = webhookUrl.includes("?") ? "&" : "?"
    return `${webhookUrl}${joiner}timestamp=${timestamp}&sign=${sign}`
}

async function postToDingTalk(webhookUrl, payload) {
    const res = await axios.post(webhookUrl, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
    })

    if (res && res.data && typeof res.data.errcode === "number" && res.data.errcode !== 0) {
        const errmsg = typeof res.data.errmsg === "string" ? res.data.errmsg : "Unknown error"
        const err = new Error(`DingTalk error: ${res.data.errcode} ${errmsg}`)
        err.dingtalk = res.data
        throw err
    }

    return res
}

async function sendDingTalkText(webhookUrl, text, atAll) {
    const content = clipText(text, MAX_DINGTALK_TEXT_LENGTH)
    return postToDingTalk(webhookUrl, {
        msgtype: "text",
        text: { content },
        at: { isAtAll: Boolean(atAll) }
    })
}

function getReportIntervalMs() {
    const envMs = process.env.DINGTALK_REPORT_INTERVAL_MS
    const envSeconds = process.env.DINGTALK_REPORT_INTERVAL_SECONDS

    let ms = null
    if (envMs != null) ms = Number(envMs)
    else if (envSeconds != null) ms = Number(envSeconds) * 1000

    if (!Number.isFinite(ms) || ms <= 0) ms = 5 * 60 * 1000
    ms = Math.max(ms, 10 * 1000)
    return Math.floor(ms)
}

function formatCountsSnapshot() {
    const entries = Array.from(countsByPlaceKey.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)

    const total = entries.reduce((sum, [, n]) => sum + n, 0)
    const lines = entries.map(([k, n]) => `${n} - ${k}`)

    return { total, lines, truncated: countsByPlaceKey.size > entries.length }
}

async function trySendReport() {
    if (countsByPlaceKey.size === 0) return

    const baseWebhookUrl = process.env.DINGTALK_WEBHOOK_URL
    const webhookUrl = buildDingTalkWebhookUrl(baseWebhookUrl)
    if (!webhookUrl) return

    const now = Date.now()
    const intervalMs = getReportIntervalMs()
    if (now - lastReportAtMs < intervalMs) return

    const startedAt = new Date(lastReportAtMs).toISOString()
    const endedAt = new Date(now).toISOString()
    const snapshot = formatCountsSnapshot()

    const body =
        `反馈统计（按 PlaceId/PlaceName）\n` +
        `时间范围: ${startedAt} ~ ${endedAt}\n` +
        `总数: ${snapshot.total}\n` +
        (snapshot.lines.length ? snapshot.lines.join("\n") : "无") +
        (snapshot.truncated ? "\n(已截断，仅展示前 30 条)" : "")

    await sendDingTalkText(webhookUrl, body, false)

    countsByPlaceKey = new Map()
    lastReportAtMs = now
}

function ensureReporterStarted() {
    if (isReporterStarted) return
    isReporterStarted = true

    const intervalMs = getReportIntervalMs()
    reportTimer = setInterval(() => {
        trySendReport().catch(() => {})
    }, Math.min(intervalMs, 60 * 1000))

    if (typeof reportTimer.unref === "function") reportTimer.unref()
}

exports.handler = async (event, context) => {
    if (context && typeof context === "object") {
        context.callbackWaitsForEmptyEventLoop = false
    }

    ensureReporterStarted()

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

    const webhookUrl = process.env.DINGTALK_WEBHOOK_URL

    if (!webhookUrl) {
        return {
            statusCode: 500,
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            body: JSON.stringify({ error: "DINGTALK_WEBHOOK_URL is not configured" })
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
        const parsed = parseDiscordContent(payload.content)
        addCount(parsed.placeId, parsed.placeName)

        const placeKey = getPlaceKey(parsed.placeId, parsed.placeName)
        const text =
            `来自 Discord 的反馈\n` +
            `Place: ${placeKey}\n` +
            (parsed.playerDisplayName ? `玩家: ${parsed.playerDisplayName}\n` : "") +
            (parsed.header ? `类型: ${parsed.header}\n` : "") +
            `内容:\n` +
            (parsed.feedback ? parsed.feedback : parsed.rawContent)

        const finalWebhookUrl = buildDingTalkWebhookUrl(webhookUrl)
        await sendDingTalkText(finalWebhookUrl, text, false)

        await trySendReport()

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
            body: JSON.stringify({ error: "Failed to send to DingTalk" })
        }
    }
}
