'use strict';

const axios = require('axios')
const websocket = require('ws');
var Twit = require('twit')

const keys = require("./keys")
const config = require("./config")

let { consumer_key, consumer_secret, access_token, access_token_secret, api_key } = keys
let { minEOSToTweet, secondsToListen } = config


// ----------
// dfuse
// ----------
let getJWT = async () => {
  const result = await axios({
    method: 'post',
    url: 'https://auth.dfuse.io/v1/auth/issue',
    data: { api_key }
  })
  return result.data
}
let globalJWT = {
  token: 'eyJhbGciOiJLTVNFUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE1NjEyMzU2NDgsImp0aSI6IjZlZDhkZGM4LWZhNDMtNGM4OS04NjJmLTIyMjRhNzZmNThiNCIsImlhdCI6MTU2MTE0OTI0OCwiaXNzIjoiZGZ1c2UuaW8iLCJzdWIiOiJ1aWQ6MHZpdGE2ZjgwOGM1NmJiNTFjODVlIiwidXNnIjoic2VydmVyIiwiYWtpIjoiYjY4ZjI1MjJjMmU2ZDk2MGY5NDFkNzZiZDEwYjhhZTdkZWM5MTllNWZkYTNkY2Y5MjczN2Y3YTcyMWMwNGZjNCIsInRpZXIiOiJmcmVlLXYxIiwic3RibGsiOi0zNjAwLCJ2IjoxfQ.6GNN1n2dhkfOUGGwIBWT4zNF-Ol6gY6xLK8n-Q7zX9zHt5WV6ziR8yrKRJtIszfAFDJ6cXNPk8vcOPopx6nqvA',
  expires_at: 1561235286
}  // default empty jwt.


// ----------
// twitter
// ----------
let T = new Twit({
  consumer_key,
  consumer_secret,
  access_token,
  access_token_secret,
  timeout_ms: 60 * 1000,  // optional HTTP request timeout to apply to all requests.
  strictSSL: true,     // optional - requires SSL certificates to be valid.
})
let tweetTX = async (quantity, reason, txid) => {
  quantity = quantity.split(" ")
  let theTweet = `${quantity[0]} #${quantity[1]} deposited to #REX for ${reason}! https://bloks.io/transaction/${txid}`
  console.log(theTweet)
  // only tweet over if tx is over 100 EOS.
  if (Boolean(parseFloat(quantity[0]) >= minEOSToTweet)) {
    console.log("POSTING TO TWITTER")
    await T.post('statuses/update', { status: theTweet })
  }
}

// ----------
// wait 
// ----------
let wait = async (sec) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => resolve(true), sec * 1000)
  });
}

// ----------
// lambda; monitor
// ----------

module.exports.monitor = async (event) => {
  let timeInHour = Math.floor(Date.now() / 1000) + 3600
  if (Boolean(JSON.stringify(globalJWT) === "{}") || (globalJWT.expires_at < timeInHour)) {
    // must grab a new token..
    console.log("Grabbing new JWT..")
    globalJWT = await getJWT()
  }

  // open socket
  const ws = new websocket(`wss://mainnet.eos.dfuse.io/v1/stream?token=${globalJWT.token}`)
  ws.on('open', () => {
    ws.send(JSON.stringify({
      "type": "get_action_traces",
      "listen": true,
      "req_id": "ramnamefees",
      "irreversible_only": true,
      "data": {
        "accounts": "eosio.token",
        "action_name": "transfer",
        "receiver": "eosio.rex",
        "with_dtrxops": true
      }
    }));

    ws.send(JSON.stringify({
      "type": "get_action_traces",
      "listen": true,
      "req_id": "rentcpu",
      "irreversible_only": true,
      "data": {
        "accounts": "eosio",
        "action_name": "rentcpu",
        "with_dtrxops": true
      }
    }));

    ws.send(JSON.stringify({
      "type": "get_action_traces",
      "listen": true,
      "req_id": "rentnet",
      "irreversible_only": true,
      "data": {
        "accounts": "eosio",
        "action_name": "rentnet",
        "with_dtrxops": true
      }
    }));
  });

  // listen for new tx.
  ws.on('message', (e, msg) => {
    try {
      let data = JSON.parse(e)
      console.log(data)
      let txTrace = data.data.trace
      let action = txTrace.act.data
      let { from, quantity } = action
      if (from === "eosio.ramfee") {
        // potential ram tweet.
        tweetTX(quantity, 'RAM trading fees', data.data.trx_id)
      }

      if (from === "eosio.names") {
        // potential name tweet.
        tweetTX(quantity, 'premium account', data.data.trx_id)
      }



    } catch (e) {
      console.log("Could not parse action.")
    }
  })


  // wait a little bit of time.
  await wait(secondsToListen)

  // open jwt
  return { message: 'Transactions streamed', event };
}