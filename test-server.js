const express = require('express');
const app = express();
const port = 3000;

const fileCache = new Map();
fileCache.set('mockhash', {
    channelId: '123',
    messageId: 456,
    fileName: 'test.txt',
    fileSize: 1000,
    mimeType: 'text/plain',
    expiresAt: new Date(Date.now() + 86400000),
    message: {} // mock message
});

app.get('/api/get_link', (req, res) => {
    res.json({
        success: true,
        data: {
            api_status_code: 200,
            data: {
                status: "success",
                link: "http://localhost:3000/stream/mockhash",
                expiry: new Date(Date.now() + 86400000).toISOString(),
                file_name: "test.txt"
            }
        }
    });
});

app.get('/stream/:hash', (req, res) => {
    // we just want to test range headers parsing logic without telegram
    let range = req.headers.range;
    if (!range) {
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', 1000);
        return res.status(200).send("FULL CONTENT");
    }
    const parts = range.replace(/bytes=/, "").split("-");
    const partialstart = parts[0];
    const partialend = parts[1];
    const start = parseInt(partialstart, 10);
    const end = partialend ? parseInt(partialend, 10) : 999;
    const chunksize = (end - start) + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/1000`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', chunksize);
    res.send("PARTIAL CONTENT " + start + "-" + end);
});

app.listen(port, () => console.log('Mock server running'));
