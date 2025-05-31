require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const {
  joinVoiceChannel,
  getVoiceConnection,
  leaveVoiceChannel,
} = require("@discordjs/voice");
const exec = require("child_process").exec;
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is online!');
});

app.listen(3000, () => {
  console.log('Web server is running on port 3000');
});

const token = process.env.DISCORD_TOKEN;
const targetChannelId = process.env.CHAT_ID;
const ownerId = process.env.OWNER_ID;
const BAD_WORDS = [
  "shit",
  "fuck",
  "bitch",
  "nigga",
  "asshole",
  "hoe",
  "dick",
  "nigger",
  "onlyfans",
  "porn",
];

const voiceCallsFile = "./voicecalls.json";
const messageCountFile = "./messagecount.json";

// Load or initialize voice call data
let voiceData = {};
try {
  voiceData = JSON.parse(fs.readFileSync(voiceCallsFile, "utf8"));
} catch {
  voiceData = { totalTime: 0, currentRecord: "record1", records: {} };
  voiceData.records["record1"] = 0;
}

// Load or initialize message count data
let messageCounts = {};
try {
  messageCounts = JSON.parse(fs.readFileSync(messageCountFile, "utf8"));
} catch {
  messageCounts = {};
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once("ready", () => {
  console.log(`Bot is online as ${client.user.tag}`);
});

// Helper: Save voice call data safely
function saveVoiceData() {
  // Make sure numbers are stored correctly
  if (typeof voiceData.totalTime !== "number")
    voiceData.totalTime = Number(voiceData.totalTime) || 0;
  Object.keys(voiceData.records).forEach((rec) => {
    if (typeof voiceData.records[rec] !== "number")
      voiceData.records[rec] = Number(voiceData.records[rec]) || 0;
  });
  fs.writeFileSync(voiceCallsFile, JSON.stringify(voiceData, null, 2));
}

// Helper: Save message count data safely
function saveMessageCounts() {
  fs.writeFileSync(messageCountFile, JSON.stringify(messageCounts, null, 2));
}

// Track voice join time for owner only
let callStartTime = null;

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Count messages for message count tracking
  const userId = message.author.id;
  if (!messageCounts[userId]) messageCounts[userId] = 0;
  messageCounts[userId]++;
  saveMessageCounts();

  // Bad word check for any message (DM or guild)
  if (BAD_WORDS.some((word) => message.content.toLowerCase().includes(word))) {
    try {
      await message.author.send("Please do not send hate messages.");
      console.log(`DM sent to ${message.author.tag} for bad language.`);
    } catch (error) {
      console.error(`Could not DM ${message.author.tag}:`, error);
    }
  }

  if (message.channel.id !== targetChannelId) return;

  const userMessage = message.content.toLowerCase();

  // Voice join command with tracking logic
  if (userMessage.startsWith("?join")) {
    if (!message.member.voice.channel) {
      return message.reply("You need to be in a voice channel for me to join!");
    }
    try {
      joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });
      message.reply("Joined the voice channel!");
    } catch (error) {
      console.error(error);
      message.reply("There was an error trying to join the voice channel.");
      return;
    }

    // Only owner can use tracktime commands
    if (message.author.id === ownerId) {
      const args = userMessage.split(" ").slice(1); // get args after ?join

      // Default record to currentRecord
      let record = voiceData.currentRecord || "record1";
      if (!voiceData.records[record]) voiceData.records[record] = 0;
      if (voiceData.totalTime == null) voiceData.totalTime = 0;

      if (args.length === 0) {
        // No argument: continue current tracking
        if (!callStartTime) {
          callStartTime = Date.now();
          message.channel.send(`Tracking started/resumed on ${record}.`);
        } else {
          message.channel.send(`Already tracking on ${record}.`);
        }
      } else {
        // Arguments handling
        const command = args[0];

        if (command === "tracktimeload") {
          // Load last record
          record = voiceData.currentRecord || "record1";
          if (!voiceData.records[record]) voiceData.records[record] = 0;
          voiceData.currentRecord = record;
          callStartTime = Date.now();
          message.channel.send(`Loaded and tracking time for ${record}.`);
        } else if (command === "tracktimestop") {
          // Stop and reset current record timer to 0 and start fresh
          voiceData.records[record] = 0;
          voiceData.currentRecord = record;
          callStartTime = Date.now();
          message.channel.send(
            `Reset and started tracking from 0 for ${record}.`,
          );
          saveVoiceData();
        } else if (command.startsWith("tracktimeloadrecord")) {
          // e.g. tracktimeloadrecord1, tracktimeloadrecord2 ...
          const recNumber = command.replace("tracktimeloadrecord", "");
          if (recNumber) {
            record = `record${recNumber}`;
            if (!voiceData.records[record]) voiceData.records[record] = 0;
            voiceData.currentRecord = record;
            callStartTime = Date.now();
            message.channel.send(`Loaded and tracking time for ${record}.`);
          }
        } else {
          // Unknown argument fallback
          message.channel.send(`Unknown tracking command: ${command}`);
        }
      }

      saveVoiceData();
    }
    return;
  }

  // Voice leave command
  if (userMessage === "?leave") {
    // If owner, update call time on leave
    if (message.author.id === ownerId && callStartTime) {
      const now = Date.now();
      const diffSec = Math.floor((now - callStartTime) / 1000);

      const record = voiceData.currentRecord || "record1";
      if (!voiceData.records[record]) voiceData.records[record] = 0;

      voiceData.records[record] += diffSec;
      voiceData.totalTime += diffSec;

      callStartTime = null;
      saveVoiceData();

      message.channel.send(
        `Call time added: ${diffSec} seconds to ${record}. Total time: ${voiceData.totalTime} seconds.`,
      );
    }

    // Disconnect bot from voice channel if connected
    const connection = getVoiceConnection(message.guild.id);
    if (connection) {
      connection.destroy();
      message.channel.send("Left the voice channel.");
    } else {
      message.channel.send("I am not in a voice channel.");
    }
    return;
  }

  // Owner-only commands
  if (message.author.id === ownerId) {
    switch (userMessage) {
      case "!start":
        message.channel.send("Starting bot...");
        exec("node index.js", (err, stdout, stderr) => {
          if (err) {
            message.channel.send(`Error: ${err.message}`);
            return;
          }
          if (stderr) {
            message.channel.send(`stderr: ${stderr}`);
            return;
          }
          message.channel.send(`stdout: ${stdout}`);
        });
        break;

      case "!restart":
        message.channel.send("Restarting bot...");
        client.destroy();
        client.login(token);
        message.channel.send("The bot is online! - owner says. 🦍");
        break;

      case "!shutdown":
        message.channel.send("Shutting down bot...");
        client.destroy();
        break;

      case "!offline":
        message.channel.send("Going invisible...");
        client.user.setStatus("invisible");
        console.log("Status changed to: Invisible (Offline)");
        break;

      case "!online":
        message.channel.send("Going online...");
        client.user.setStatus("online");
        console.log("Status changed to: Online");
        break;

      case "!donotdisturb":
        message.channel.send("Do Not Disturb mode activated...");
        client.user.setStatus("dnd");
        console.log("Status changed to: Do Not Disturb");
        break;
    }
  }

  // Public commands anyone can use
  if (userMessage === "!info") {
    message.channel.send(
      "I am a Gorilla Tag monke bot! 🦍 I help you with Gorilla Tag-related questions and have fun with you!",
    );
  }

  if (userMessage === "!ping") {
    message.channel.send("Pong! 🦍");
  }

  if (userMessage === "!hello") {
    message.channel.send("OOGA BOOGA! Hello there, monke! 🦍");
  }

  if (userMessage === "!tag") {
    message.channel.send("OOGA BOOGA! Let’s tag, monke! 🦍");
  }

  // Message count rank command
  if (userMessage === "!rank") {
    const count = messageCounts[userId] || 0;
    message.channel.send(
      `${message.author.username}, you have sent ${count} message${count !== 1 ? "s" : ""}!`,
    );
  }
});

client.login(token);

