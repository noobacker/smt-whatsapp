# WhatsApp Statement Bot

A WhatsApp bot that automatically sends statement PDFs to customers by matching their phone numbers with the customer database.

## Features

- Automatically matches WhatsApp numbers with customer records (checks both `customerName` and `city` fields)
- Checks if statements are available for the matched customer
- Sends latest statement PDF if available
- Stores all request logs in the database
- Admin panel to view all WhatsApp statement requests
- Persistent session to avoid scanning QR code on restart
- Automatically reconnects if disconnected

## Setup Instructions

### Local Development

1. Clone this repository
2. Install dependencies:

```bash
cd whatsapp-bot
npm install
```

3. Create a `.env` file in the whatsapp-bot directory with the following variables:

```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database
NEXT_PUBLIC_APP_URL=http://localhost:3000  # URL of your Next.js application
```

4. Start the bot in development mode:

```bash
npm run dev
```

5. Scan the QR code with your WhatsApp to authenticate the session

### Production Deployment on Railway.app

1. Create a new project on [Railway.app](https://railway.app)
2. Connect your GitHub repository
3. Select the whatsapp-bot directory
4. Add the following environment variables:
   - `MONGODB_URI` - Your MongoDB connection string
   - `NEXT_PUBLIC_APP_URL` - URL of your deployed Next.js application
5. Deploy the service

## Usage Instructions

1. Start the WhatsApp bot
2. The bot will automatically respond to messages from customers
3. When a customer sends any message, the bot will:
   - Check if their phone number matches any customer in the database
   - If matched, check if a statement is available for that customer
   - Send the statement PDF if available, or send an appropriate message if no statement is found
4. View all WhatsApp requests in the admin panel at `/whatsapp-requests`

## Testing the Bot

To test if the bot is working correctly:

1. Ensure that a test customer has been added to the database with a phone number
2. Upload a statement with data for that customer
3. Send a WhatsApp message to the bot from the phone number associated with the customer
4. The bot should respond with the statement PDF

## Troubleshooting

- If the bot disconnects frequently, check the Railway.app logs
- Ensure that the MongoDB connection string is correct
- Make sure the Next.js application is running and accessible
- Check that statements have been uploaded correctly
- Verify that phone numbers in the customer database match the format of incoming WhatsApp numbers 