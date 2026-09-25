#!/usr/bin/env node
"use strict";

// Minimal static file server + CORS-safe proxy for the BSI chat REST API.
// The Kore.ai chat endpoint only allows requests from its own origin, so the
// browser can never call it directly — this server serves the site and
// forwards /api/bsi-chat requests to Kore.ai server-side, where CORS doesn't
// apply. It also keeps the API key out of client-side JS.
//
// Run: node server.js   (defaults to http://localhost:3000)

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;

const BSI_CHAT_API_URL = "https://agents-staging.kore.ai/api/v1/project/bsi-aisyah-sales-service/draft/agent/bsi-aisyah-supervisor/chat";
const BSI_CHAT_API_KEY = process.env.BSI_CHAT_API_KEY || "abl_f88941078cd3a0155ac974c8aba176110b7d4a7ae95f8934";

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > 1e6) {
                reject(new Error("Request body too large"));
                req.destroy();
            }
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });
}

async function handleBsiChatProxy(req, res) {
    let payload;
    try {
        const raw = await readRequestBody(req);
        payload = raw ? JSON.parse(raw) : {};
    } catch (err) {
        return sendJson(res, 400, { error: "Invalid JSON body" });
    }

    if (!payload || typeof payload.message !== "string" || !payload.message.trim()) {
        return sendJson(res, 400, { error: '"message" is required' });
    }

    const forwardBody = { message: payload.message };
    if (payload.sessionId) forwardBody.sessionId = payload.sessionId;
    if (payload.sessionMetadata) forwardBody.sessionMetadata = payload.sessionMetadata;

    try {
        const apiRes = await fetch(BSI_CHAT_API_URL, {
            method: "POST",
            headers: {
                "x-api-key": BSI_CHAT_API_KEY,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(forwardBody),
        });
        const data = await apiRes.json();
        return sendJson(res, apiRes.status, data);
    } catch (err) {
        console.error("BSI chat proxy error:", err);
        return sendJson(res, 502, { error: "Could not reach the chat service. Please try again." });
    }
}

function serveStaticFile(req, res) {
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    // Only index-chat.html is wired up to the /api/bsi-chat proxy — serve it
    // at the root so the chat integration is what you land on by default.
    if (urlPath === "/") urlPath = "/index-chat.html";

    const filePath = path.join(ROOT_DIR, urlPath);
    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403);
        return res.end("Forbidden");
    }

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("Not found");
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
        res.end(content);
    });
}

const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/bsi-chat") {
        return handleBsiChatProxy(req, res);
    }
    if (req.method === "GET" || req.method === "HEAD") {
        return serveStaticFile(req, res);
    }
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method not allowed");
});

server.listen(PORT, () => {
    console.log(`BSI static site + chat proxy running at http://localhost:${PORT}`);
});
