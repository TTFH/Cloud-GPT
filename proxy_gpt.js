import http from "axios";
import express from "express";
import dotenv from "dotenv";

dotenv.config();
const PORT = process.env.PORT || 3000;
const app = express().use(express.json());

const FB_BASE_URL = "https://graph.facebook.com/v23.0";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

const GPT_URL = process.env.GPT_URL;
const API_KEY = process.env.API_KEY;
const COMPANY = process.env.COMPANY;

function StartServer() {
	console.log("Starting server on port", PORT);
	console.log(
		"Webhook listening for incoming messages to",
		process.env.PHONE_NUMBER
	);
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
			const message = `Ocurrio un error.\n${error.response.error}`;
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

		if (message.type === "text") {
			const message_id = message.id;
			const msg_body = message.text.body;

			console.log(">", msg_body);
			MarkAsRead(message_id).catch(error => {
				console.log("ERROR MarkAsRead", error);
			});

			QueryGPT(msg_body)
				.then(gpt_response => {
					console.log("-", gpt_response);
					sendTextReplyWpp(phone_number, message_id, gpt_response)
						.catch(error => {
							console.log("ERROR sendTextReplyWpp", error);
						});
				})
				.catch(error => {
					console.log("ERROR QueryGPT", error);
				});
		} else console.log(JSON.stringify(req.body));
	}
	res.sendStatus(200);
}

app.listen(PORT, StartServer);
app.get("/", (req, res) => {
	res.send("Webhook is running");
});
app.post("/ping", (req, res) => {
	res.send(req.body);
});
app.post("/webhook", ReceiveNotification);
