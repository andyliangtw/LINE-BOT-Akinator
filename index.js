'use strict';

const line = require('@line/bot-sdk');
const express = require('express');
const { Aki } = require('./aki-api');

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};
const baseURL = process.env.BASE_URL;
const client = new line.Client(config);
const aki = new Aki('en');

const app = express();

app.use('/images', express.static('images'));

app.get('/callback', (req, res) =>
  res.end(`I'm listening. Please access with POST.`),
);

app.post('/callback', line.middleware(config), (req, res) => {
  if (req.body.destination) {
    console.log('Destination User ID: ' + req.body.destination);
  }

  // req.body.events should be an array of events
  if (!Array.isArray(req.body.events)) {
    return res.status(500).end();
  }

  // handle events separately
  Promise.all(req.body.events.map(handleEvent))
    .then(() => res.end())
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

const replyText = (token, texts) => {
  texts = Array.isArray(texts) ? texts : [texts];
  return client.replyMessage(
    token,
    texts.map((text) => ({ type: 'text', text })),
  );
};

async function getUserNameById(userId) {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    method: 'GET',
    Authorization: `Bearer ${process.env.CHANNEL_ACCESS_TOKEN}`,
  });
  const data = await res.json();
  return data.displayName;
}

function handleEvent(event) {
  const { replyToken } = event;

  if (replyToken && replyToken.match(/^#.*$/)) {
    return console.log('Test hook recieved: ' + JSON.stringify(event.message));
  }

  switch (event.type) {
    case 'message':
      const { message } = event;
      switch (message.type) {
        case 'text':
          return handleText(message, replyToken, event.source);
        case 'sticker':
          return handleSticker(message, replyToken);
        default:
          return Promise.resolve(null);
      }

    case 'follow':
      return replyText(replyToken, 'Challenge me. I will read your mind.');

    case 'unfollow':
      return console.log(`Unfollowed this bot: ${JSON.stringify(event)}`);

    case 'join':
      return replyText(replyToken, 'Akinator is omniscient.');

    case 'leave':
      return console.log(`Left: ${JSON.stringify(event)}`);

    default:
      throw new Error(`Unknown event: ${JSON.stringify(event)}`);
  }
}

function handleText(message, replyToken, source) {
  const optionToNum = {
    Yes: 0,
    No: 1,
    "Don't know": 2,
    Probably: 3,
    'Probably not': 4,
  };

  const optionObj = {
    type: 'imagemap',
    baseUrl: `${baseURL}/images/options`,
    altText: 'Akinator options',
    baseSize: { width: 1040, height: 1040 },
    actions: Object.keys(optionToNum).map((option, i) => {
      return {
        area: { x: 0, y: 208 * i, width: 1040, height: 208 },
        type: 'message',
        text: option,
      };
    }),
  };

  switch (message.text.trim()) {
    case 'start':
      return aki.start().then(() => {
        return client.replyMessage(replyToken, [
          {
            type: 'text',
            text:
              'Think about a real or fictional character.\nI will try to guess who it is.',
          },
          {
            type: 'text',
            text: `Question ${aki.currentStep + 1}:\n${
              `*${aki.question}*` || 'Akinator has no question to you.'
            }`,
          },
          optionObj,
          {
            type: 'text',
            text: 'Or type `back` to back to previous question.',
          },
        ]);
      });

    case 'Yes':
    case 'No':
    case "Don't know":
    case 'Probably':
    case 'Probably not':
      if (!aki.gameStarted) {
        return replyText(replyToken, 'Please start the game first.');
      }
      if (aki.gameEnded) {
        return replyText(replyToken, 'Type `start` again to start a new game.');
      }

      return aki.step(optionToNum[message.text]).then(() => {
        if (aki.progress >= 80 || aki.currentStep >= 50) {
          return aki.win().then(() => {
            const answer = aki.answers[0];
            return client.replyMessage(replyToken, [
              {
                type: 'text',
                text:
                  `I think of *${answer.name}* (${answer.description}).` ||
                  'Akinator went wrong...',
              },
              {
                type: 'image',
                originalContentUrl:
                  answer.absolute_picture_path || `${baseURL}/images/icon.jpg`,
                previewImageUrl:
                  answer.absolute_picture_path || `${baseURL}/images/icon.jpg`,
              },
              {
                type: 'text',
                text: 'Type `start` again to start a new game.',
              },
            ]);
          });
        }

        return client.replyMessage(replyToken, [
          {
            type: 'text',
            text: `Question ${aki.currentStep + 1}:\n${
              `*${aki.question}*` || 'Akinator has no question to you.'
            }`,
          },
          optionObj,
          {
            type: 'text',
            text: 'Or type `back` to back to previous question.',
          },
        ]);
      });

    case 'back':
      if (!aki.gameStarted) {
        return replyText(replyToken, 'Please start the game first.');
      }

      return aki.back().then(() =>
        client.replyMessage(replyToken, [
          {
            type: 'text',
            text: `(Back) Question ${aki.currentStep + 1}:\n${
              `*${aki.question}*` || 'Akinator has no question to you.'
            }`,
          },
          optionObj,
          {
            type: 'text',
            text: 'Or type `back` to back to previous question.',
          },
        ]),
      );

    case 'bye':
      switch (source.type) {
        case 'user':
          return replyText(replyToken, 'Akinator is inevitable.');
        case 'group':
          return replyText(
            replyToken,
            'However... Akinator is not omnipotent.',
          ).then(() => client.leaveGroup(source.groupId));
        case 'room':
          return replyText(
            replyToken,
            'However... Akinator is not omnipotent.',
          ).then(() => client.leaveRoom(source.roomId));
      }

    default:
      if (aki.gameStarted) {
        return replyText(replyToken, 'Akinator is asking!');
      }
      return replyText(replyToken, 'Type `start` to start the game.');
  }
}

function handleSticker(message, replyToken) {
  return client.replyMessage(replyToken, {
    type: 'sticker',
    packageId: message.packageId,
    stickerId: message.stickerId,
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`listening on ${baseURL}:${port}/callback`);
});
