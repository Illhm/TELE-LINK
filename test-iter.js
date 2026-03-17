const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { iterDownload } = require("telegram/client/downloads");

console.log(typeof iterDownload);
