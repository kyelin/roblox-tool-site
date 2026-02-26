// Roblox 点赞数据函数代理
const axios = require("axios")

const cache = {}
const CACHE_TIME = 60 * 1000
// 允许访问的 universeId 列表，在此配置你的游戏 universeId
const ALLOWED_UNIVERSE_IDS = [
    "9325757128"
]

// 函数入口，访问路径为 /functions/votes?universeId=xxxxx
exports.handler = async (event) => {
    const params = event.queryStringParameters || {}
    const universeId = params.universeId

    if (!universeId) {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Missing universeId query parameter" })
        }
    }

    if (!ALLOWED_UNIVERSE_IDS.includes(universeId)) {
        return {
            statusCode: 403,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "universeId not supported" })
        }
    }

    if (cache[universeId] && Date.now() - cache[universeId].lastFetch < CACHE_TIME) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cache[universeId].data)
        }
    }

    try {
        const response = await axios.get(
            `https://games.roblox.com/v1/games/votes?universeIds=${universeId}`
        )

        if (!response.data || !response.data.data || !response.data.data[0]) {
            return {
                statusCode: 404,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "No vote data found" })
            }
        }

        const d = response.data.data[0]

        const data = {
            upVotes: d.upVotes,
            downVotes: d.downVotes,
            likeRatio: (d.upVotes + d.downVotes > 0) ? d.upVotes / (d.upVotes + d.downVotes) : 0
        }

        cache[universeId] = { data, lastFetch: Date.now() }

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        }
    } catch (err) {
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Failed to fetch votes" })
        }
    }
}
