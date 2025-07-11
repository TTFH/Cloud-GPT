import fs from "fs";
import http from "axios";
import express from "express";
import dotenv from "dotenv";

dotenv.config();
const app = express().use(express.json());

const PORT = 3000;

const FB_BASE_URL = "https://graph.facebook.com/v23.0";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

const GPT_URL = process.env.GPT_URL;
const API_KEY = process.env.API_KEY;
const COMPANY = process.env.COMPANY;

const db_filename = "./log.json";
var database = { users: {}, messages: {} };

function StartServer() {
	console.log(
		"Webhook listening for incoming messages to",
		process.env.PHONE_NUMBER
	);
	if (fs.existsSync(db_filename)) {
		const rawdata = fs.readFileSync(db_filename);
		database = JSON.parse(rawdata);
	}
	database.update = () => {
		const data = JSON.stringify(database);
		fs.writeFileSync(db_filename, data);
	};
}

function QueryGPT(message) {
	return new Promise(async (resolve, reject) => {
		try {
			const response = await http.post(
				GPT_URL,
				{
					prompt: message,
				},
				{
					headers: {
						"Content-Type": "application/json",
						"x-api-key": API_KEY,
						Empresa: COMPANY,
					},
				}
			);
			const result = response.data.friendlyText || response.data.error;
			resolve(result);
		} catch (error) {
			const message = `Ocurrio un error.\n ${error.response.error}`;
			resolve(message);
			//reject(error.message);
		}
	});
}

async function sendTextReplyWpp(phone_number, reply_id, text_msg) {
	return new Promise(async (resolve, reject) => {
		try {
			const response = await http.post(
				`${FB_BASE_URL}/${PHONE_NUMBER_ID}/messages`,
				{
					messaging_product: "whatsapp",
					to: phone_number,
					context: {
						message_id: reply_id,
					},
					text: { body: text_msg },
				},
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${WHATSAPP_TOKEN}`,
					},
				}
			);
			const message_id = response.data.messages[0].id;
			resolve(message_id);
		} catch (error) {
			reject(error.message);
		}
	});
}

async function MarkAsRead(message_id) {
	new Promise(async (resolve, reject) => {
		try {
			http.post(
				`${FB_BASE_URL}/${PHONE_NUMBER_ID}/messages`,
				{
					messaging_product: "whatsapp",
					status: "read",
					message_id,
				},
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${WHATSAPP_TOKEN}`,
					},
				}
			);
			resolve();
		} catch (error) {
			reject(error.message);
		}
	});
}

function ReceiveNotification(req, res) {
	const value = req.body.entry[0].changes[0].value;
	if (value.messages) {
		const message = value.messages[0];
		const phone_number = message.from;
		const username = value.contacts[0].profile.name;
		database.users[phone_number] = { name: username };
		database.update();

		if (message.type === "text") {
			const message_id = message.id;
			const msg_body = message.text.body;
			database.messages[message_id] = {
				from: phone_number,
				caption: msg_body,
				timestamp: message.timestamp,
			};
			database.update();

			console.log(">", msg_body);
			MarkAsRead(message_id).catch(error => {
				console.log("ERROR MarkAsRead", error);
			});

			if (msg_body === "RESET") {
				for (const message_id in database.messages) {
					const msg = database.messages[message_id];
					if (msg.from === phone_number || msg.to === phone_number)
						delete database.messages[message_id];
				}
				database.update();
			} else {
				QueryGPT(msg_body)
					.then(gpt_response => {
						console.log("-", gpt_response);
						sendTextReplyWpp(phone_number, message_id, gpt_response)
							.then(message_id => {
								database.messages[message_id] = {
									to: phone_number,
									caption: gpt_response,
									timestamp: Math.floor(Date.now() / 1000),
								};
								database.update();
							})
							.catch(error => {
								console.log("ERROR sendTextReplyWpp", error);
							});
					})
					.catch(error => {
						console.log("ERROR QueryGPT", error);
					});
			}
		} else console.log(JSON.stringify(req.body));
	}
	res.sendStatus(200);
}

app.listen(PORT, StartServer);
app.post("/webhook", ReceiveNotification);
