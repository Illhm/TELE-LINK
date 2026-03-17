const express = require('express');
const { Api, TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const crypto = require('crypto');
const mime = require('mime-types');
const bigInt = require('big-integer');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const apiId = parseInt(process.env.API_ID || '0');
const apiHash = process.env.API_HASH || '';
const stringSession = new StringSession(process.env.SESSION_STRING || '');

if (!apiId || !apiHash || !process.env.SESSION_STRING) {
    console.error("Please provide API_ID, API_HASH, and SESSION_STRING in environment variables (.env).");
    process.exit(1);
}

const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
});

// In-memory store for file hashes mapping to message details
const fileCache = new Map();

// Background garbage collector to clean up expired links from the cache
setInterval(() => {
    const now = new Date();
    for (const [hash, fileData] of fileCache.entries()) {
        if (now > fileData.expiresAt) {
            fileCache.delete(hash);
        }
    }
}, 60 * 60 * 1000); // Run every hour

app.get('/api/get_link', async (req, res) => {
    try {
        const channelId = req.query.channel_id;
        const messageId = parseInt(req.query.message_id);

        if (!channelId || isNaN(messageId)) {
            return res.status(400).json({ error: "Missing or invalid channel_id / message_id" });
        }

        // Fetch the message from the channel
        const result = await client.getMessages(channelId, { ids: messageId });

        if (!result || result.length === 0 || !result[0]) {
            return res.status(404).json({ error: "Message not found" });
        }

        const message = result[0];

        // Check if the message has media (Document, Photo, Video, etc)
        if (!message.media) {
            return res.status(400).json({ error: "Message does not contain media" });
        }

        let fileName = 'downloaded_file';
        let fileSize = 0;
        let mimeType = 'application/octet-stream';

        // Extract metadata if available
        if (message.media && message.media.document) {
            const doc = message.media.document;
            fileSize = doc.size;
            mimeType = doc.mimeType || mimeType;

            // Find file name from attributes
            if (doc.attributes) {
                for (const attr of doc.attributes) {
                    if (attr.className === 'DocumentAttributeFilename') {
                        fileName = attr.fileName;
                        break;
                    }
                }
            }
        }

        // Create a unique hash for this download link
        const hash = crypto.randomBytes(16).toString('hex');
        const expiryDate = new Date();
        expiryDate.setHours(expiryDate.getHours() + 24); // Expiry in 24 hours

        // Save the mapping to memory cache
        fileCache.set(hash, {
            channelId,
            messageId,
            fileName,
            fileSize,
            mimeType,
            expiresAt: expiryDate,
            message: message // Cache the message object directly so we don't have to fetch it again
        });

        const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;
        const streamLink = `${baseUrl}/stream/${hash}`;

        const responseData = {
            success: true,
            data: {
                api_status_code: 200,
                data: {
                    status: "success",
                    link: streamLink,
                    expiry: expiryDate.toISOString(),
                    file_name: fileName
                }
            }
        };

        return res.json(responseData);

    } catch (error) {
        console.error("Error in /api/get_link:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});

app.get('/stream/:hash', async (req, res) => {
    try {
        const hash = req.params.hash;

        if (!fileCache.has(hash)) {
            return res.status(404).send('File not found or link expired.');
        }

        const fileData = fileCache.get(hash);

        if (new Date() > fileData.expiresAt) {
            fileCache.delete(hash);
            return res.status(410).send('Download link expired.');
        }

        const message = fileData.message;
        const totalSize = parseInt(fileData.fileSize);
        const fileName = fileData.fileName;
        const mimeType = fileData.mimeType;

        // Parse Range headers for HTTP 206 Partial Content
        let range = req.headers.range;
        let start = 0;
        let end = totalSize - 1;
        let chunksize = totalSize;

        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        if (range) {
            // e.g., "bytes=100-200" or "bytes=100-"
            const parts = range.replace(/bytes=/, "").split("-");
            const partialstart = parts[0];
            const partialend = parts[1];

            start = parseInt(partialstart, 10);
            end = partialend ? parseInt(partialend, 10) : totalSize - 1;

            if (isNaN(start) || isNaN(end) || start > end || start >= totalSize || end >= totalSize) {
                return res.status(416).send('Requested Range Not Satisfiable');
            }

            chunksize = (end - start) + 1;

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
            res.setHeader('Content-Length', chunksize);
            res.flushHeaders();
        } else {
            res.setHeader('Content-Length', totalSize);
            res.flushHeaders();
        }

        // 512KB is max chunk size for Telegram, making it a constant offset
        const TG_CHUNK_SIZE = 512 * 1024;

        // Calculate the Telegram chunk offset aligned to TG_CHUNK_SIZE
        const alignStart = Math.floor(start / TG_CHUNK_SIZE) * TG_CHUNK_SIZE;
        const alignOffset = start - alignStart;

        // Number of chunks needed
        const limit = Math.ceil((chunksize + alignOffset) / TG_CHUNK_SIZE);

        console.log(`[Stream] Client requested: ${start}-${end} (${chunksize} bytes). Requesting offset ${alignStart} (limit ${limit} chunks) from Telegram.`);

        // iterDownload supports taking a specific byte offset and chunk limits
        // It provides an async iterable to get chunks one by one
        let downloadedBytes = 0;
        let isFirstChunk = true;

        for await (const chunk of client.iterDownload({
            file: message.media,
            offset: bigInt(alignStart),
            limit: limit,
            chunkSize: TG_CHUNK_SIZE,
            requestSize: TG_CHUNK_SIZE, // Keep same as chunk size to ensure chunks align perfectly with Tg offset limits
        })) {
            if (downloadedBytes >= chunksize) break;

            let chunkData = chunk;

            // Trim start of the first chunk if needed (e.g. client requested start at 100, but Tg gives from 0)
            if (isFirstChunk && alignOffset > 0) {
                chunkData = chunkData.slice(alignOffset);
                isFirstChunk = false;
            }

            // Trim end of the last chunk if it gives more than requested
            const remaining = chunksize - downloadedBytes;
            if (chunkData.length > remaining) {
                chunkData = chunkData.slice(0, remaining);
            }

            // Pipe to user (Zero storage on disk/ram)
            // Wait for drain if the buffer is full (client is slower than download)
            const canWrite = res.write(chunkData);
            if (!canWrite) {
                await new Promise((resolve) => res.once('drain', resolve));
            }

            downloadedBytes += chunkData.length;
        }

        res.end();

    } catch (error) {
        console.error("Error in /stream/:hash:", error);
        if (!res.headersSent) {
            res.status(500).send("Internal server error while streaming file");
        } else {
            res.end();
        }
    }
});

async function init() {
    console.log('Connecting to Telegram...');
    await client.connect();
    console.log('Connected to Telegram!');

    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}

init();
