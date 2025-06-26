import fs from "fs";
import http from "axios";
import express from "express";
const app = express().use(express.json());

const PORT = 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const FB_BASE_URL = "https://graph.facebook.com/v23.0";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

const OPENAI_BASE_URL = "https://models.inference.ai.azure.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const db_filename = "./database.json";
var database = { users: {}, messages: {} };

function StartServer() {
	console.log(
		"Webhook listening to incoming messages to",
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

function QueryGPT(messages) {
	return new Promise(async (resolve, reject) => {
		try {
			const response = await http.post(
				`${OPENAI_BASE_URL}/chat/completions`,
				{
					model: "o4-mini",
					messages,
				},
				{
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${GITHUB_TOKEN}`,
					},
				}
			);
			const data = response.data.choices[0].message.content;
			resolve(data);
		} catch (error) {
			reject(error.message);
		}
	});
}

async function sendTextWpp(phone_number, text_msg) {
	return new Promise(async (resolve, reject) => {
		try {
			const response = await http.post(
				`${FB_BASE_URL}/${PHONE_NUMBER_ID}/messages`,
				{
					messaging_product: "whatsapp",
					to: phone_number,
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

function MarkAsRead(message_id) {
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
}

function VerifyEndpoint(req, res) {
	if (
		req.query["hub.mode"] === "subscribe" &&
		req.query["hub.verify_token"] === VERIFY_TOKEN
	) {
		console.log("Webhook verified!");
		res.status(200).send(req.query["hub.challenge"]);
	} else {
		console.error("Failed validation. Tokens do not match.");
		res.sendStatus(403);
	}
}

function GetHistoricMessages(phone_number) {
	let messages = [
		/*{
			role: "system",
			content: "Take the role of a WhatsApp Chatbot."
		}*/
	];
	for (const message_id in database.messages) {
		const msg = database.messages[message_id];
		if (msg.from === phone_number || msg.to === phone_number) {
			messages.push({
				role: msg.from ? "user" : "assistant",
				content: msg.caption,
			});
		}
	}
	return messages;
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
			MarkAsRead(message_id);

			if (msg_body === "RESET") {
				for (const message_id in database.messages) {
					const msg = database.messages[message_id];
					if (msg.from === phone_number || msg.to === phone_number)
						delete database.messages[message_id];
				}
				database.update();
			} else {
				QueryGPT(GetHistoricMessages(phone_number))
					.then(gpt_response => {
						console.log("-", gpt_response);
						sendTextWpp(phone_number, gpt_response)
							.then(message_id => {
								database.messages[message_id] = {
									to: phone_number,
									caption: gpt_response,
									timestamp: Math.floor(Date.now() / 1000),
								};
								database.update();
							})
							.catch(error => {
								console.log("ERROR sendTextWpp", error);
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
app.get("/webhook", VerifyEndpoint);
app.post("/webhook", ReceiveNotification);
