const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;

// MongoDB client for direct database access
const { MongoClient } = require('mongodb');

// Load environment variables
require('dotenv').config();

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI;
const dbName = MONGODB_URI.split('/').pop().split('?')[0];

// Initialize WhatsApp client with persistent session
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(process.cwd(), '.wwebjs_auth')
  }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

// MongoDB connection
let db;
let partyCodes;
let statements;
let whatsappRequests;

async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    console.log('Connected to MongoDB');
    db = client.db(dbName);
    
    // Get collections
    partyCodes = db.collection('PartyCode');
    statements = db.collection('Statement');
    whatsappRequests = db.collection('WhatsAppRequest');
    
    return true;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    return false;
  }
}

// Generate and show QR code when needed
client.on('qr', (qr) => {
  console.log('QR RECEIVED. Scan with WhatsApp:');
  qrcode.generate(qr, { small: true });
});

// Ready event
client.on('ready', async () => {
  console.log('WhatsApp client is ready!');
  await connectToMongoDB();
});

// Disconnected event
client.on('disconnected', (reason) => {
  console.log('WhatsApp client was disconnected:', reason);
  // Attempt to reconnect
  client.initialize();
});

// Handle incoming messages
client.on('message', async (message) => {
  try {
    // Ignore group messages
    if (message.isGroup) return;
    
    const sender = message.from;
    const phoneNumber = sender.replace(/\D/g, ''); // Remove non-digits
    const messageText = message.body.trim();
    
    console.log(`Received message from ${phoneNumber}: ${messageText}`);
    
    // Store the request in the database
    const requestRecord = {
      phoneNumber,
      message: messageText,
      timestamp: new Date(),
      status: 'RECEIVED',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const savedRequest = await whatsappRequests.insertOne(requestRecord);
    const requestId = savedRequest.insertedId;
    
    // Start processing
    await processWhatsAppRequest(message, phoneNumber, messageText, requestId);
    
  } catch (error) {
    console.error('Error handling message:', error);
    
    // Try to respond with an error message
    try {
      await message.reply('Sorry, there was an error processing your request. Please try again later.');
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }
});

/**
 * Process an incoming WhatsApp request
 */
async function processWhatsAppRequest(message, phoneNumber, messageText, requestId) {
  try {
    // Find party matching the phone number
    const matchedParty = await findPartyByPhoneNumber(phoneNumber);
    
    if (!matchedParty) {
      // No matching party found
      await whatsappRequests.updateOne(
        { _id: requestId },
        { 
          $set: { 
            status: 'NO_MATCH',
            responseMessage: 'Your number isn\'t linked with any party.',
            updatedAt: new Date()
          } 
        }
      );
      
      await message.reply(
        'Sorry, your number isn\'t linked with any party. Please contact Sanjivan Medico Traders to add this number to their database.'
      );
      return;
    }
    
    console.log(`Found matching party: ${matchedParty.code} - ${matchedParty.customerName}`);
    
    // Update request record with matched party
    await whatsappRequests.updateOne(
      { _id: requestId },
      { 
        $set: { 
          matchedPartyCode: matchedParty.code,
          matchedPartyName: matchedParty.customerName,
          updatedAt: new Date()
        } 
      }
    );
    
    // Find statement for this party
    const hasStatement = await checkForStatement(matchedParty.code);
    
    if (!hasStatement) {
      // No statement found
      await whatsappRequests.updateOne(
        { _id: requestId },
        { 
          $set: { 
            status: 'NO_STATEMENT',
            responseMessage: `No statement found for party code ${matchedParty.code}`,
            updatedAt: new Date()
          } 
        }
      );
      
      await message.reply(
        `No statement found for "${matchedParty.code}". Please contact Sanjivan Medico Traders for more information.`
      );
      return;
    }
    
    // Generate and send statement
    await generateAndSendStatement(message, matchedParty, requestId);
    
  } catch (error) {
    console.error('Error processing WhatsApp request:', error);
    
    // Update request status to failed
    await whatsappRequests.updateOne(
      { _id: requestId },
      { 
        $set: { 
          status: 'FAILED',
          responseMessage: `Error: ${error.message}`,
          updatedAt: new Date()
        } 
      }
    );
    
    // Inform the user
    await message.reply('Sorry, there was an error processing your request. Please try again later.');
  }
}

/**
 * Find a party by phone number (search in both customerName and city fields)
 */
async function findPartyByPhoneNumber(phoneNumber) {
  // Need to search for the phone number in both customerName and city fields
  // The phone number might be formatted in various ways
  
  // Create search patterns
  const searchPatterns = [
    phoneNumber,
    phoneNumber.replace(/(\d{5})(\d{5})/, '$1 $2'),
    phoneNumber.replace(/(\d{5})(\d{5})/, '$1-$2'),
    `(${phoneNumber})`,
    `(${phoneNumber.replace(/(\d{5})(\d{5})/, '$1 $2')})`,
  ];
  
  // Create a regex pattern for searching
  const phoneRegexPatterns = searchPatterns.map(pattern => 
    new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  );
  
  // Query MongoDB for the party
  const party = await partyCodes.findOne({
    $or: [
      { customerName: { $in: phoneRegexPatterns } },
      { city: { $in: phoneRegexPatterns } }
    ]
  });
  
  return party;
}

/**
 * Check if a statement exists for the given party code
 */
async function checkForStatement(partyCode) {
  // Find the latest statement
  const latestStatement = await statements.find()
    .sort({ statementDate: -1 })
    .limit(1)
    .toArray();
  
  if (!latestStatement || latestStatement.length === 0) {
    return false;
  }
  
  // Check if there's a section for this party
  const statementId = latestStatement[0]._id;
  
  const reportSection = await db.collection('ReportSection').findOne({
    statementId,
    partyCode
  });
  
  return !!reportSection;
}

/**
 * Generate and send a statement PDF to the user
 */
async function generateAndSendStatement(message, party, requestId) {
  try {
    // Find the latest statement
    const latestStatement = await statements.find()
      .sort({ statementDate: -1 })
      .limit(1)
      .toArray();
    
    const statementId = latestStatement[0]._id;
    
    // Get the report section for this party
    const reportSection = await db.collection('ReportSection').findOne({
      statementId,
      partyCode: party.code
    });
    
    if (!reportSection) {
      throw new Error('Report section not found');
    }
    
    // Generate PDF using the API
    const response = await axios.post(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/statement-excel/pdf`,
      {
        partyCode: party.code,
        statementId: statementId.toString()
      },
      {
        responseType: 'arraybuffer'
      }
    );
    
    if (response.status !== 200) {
      throw new Error(`Failed to generate PDF: ${response.statusText}`);
    }
    
    // Convert PDF to base64
    const pdfData = Buffer.from(response.data);
    
    // Create a temporary file name
    const tempFileName = `statement_${party.code}_${Date.now()}.pdf`;
    const tempFilePath = path.join(process.cwd(), tempFileName);
    
    // Write the PDF to a temporary file
    await fs.writeFile(tempFilePath, pdfData);
    
    // Create media from file
    const media = MessageMedia.fromFilePath(tempFilePath);
    
    // Send the PDF
    await message.reply(
      `Here is your latest statement for ${party.customerName || party.code}:`
    );
    
    await message.reply(media, { caption: `Statement ${party.code}` });
    
    // Clean up the temporary file
    await fs.unlink(tempFilePath);
    
    // Update request status
    await whatsappRequests.updateOne(
      { _id: requestId },
      { 
        $set: { 
          status: 'PROCESSED',
          statementSent: true,
          responseMessage: 'Statement PDF sent successfully',
          updatedAt: new Date()
        } 
      }
    );
    
  } catch (error) {
    console.error('Error generating and sending statement:', error);
    throw error;
  }
}

// Initialize the client
client.initialize();

// Keep the process running
process.on('SIGINT', async () => {
  console.log('Shutting down WhatsApp bot...');
  await client.destroy();
  process.exit(0);
}); 