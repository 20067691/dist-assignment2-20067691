import { SNSHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";

if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM and SES_REGION environment variables in an env.js file located in the root directory"

  );
}

type ContactDetails = {
  name: string;
  email: string;
  message: string;
};

const client = new SESClient({ region: SES_REGION });

export const handler: SNSHandler = async (event) => {
  console.log("Received SNS event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      console.log("Processing record:", JSON.stringify(record, null, 2));

      // Extract SNS message
      const snsMessageString = record.Sns.Message;
      console.log("Raw SNS Message:", snsMessageString);

      // Extract SNS message
      const snsMessage = JSON.parse(record.Sns.Message);

      console.log("Parsed SNS message:", JSON.stringify(snsMessage, null, 2));


      // Process S3-related information from the SNS message
      if (snsMessage.Records) {
        for (const s3Record of snsMessage.Records) {
          const s3e = s3Record.s3;
          const srcBucket = s3e.bucket.name;
          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

          console.log(`Processing image: s3://${srcBucket}/${srcKey}`);

          // Compose email details
          const { name, email, message }: ContactDetails = {
            name: "The Photo Album",
            email: SES_EMAIL_TO,
            message: `We received your image. It is located at: s3://${srcBucket}/${srcKey}`,
          };

          // Send email
          const params = sendEmailParams({ name, email, message });
          await client.send(new SendEmailCommand(params));

          console.log(`Email sent successfully for object: ${srcKey}`);
        }
      } else {
        console.warn("No S3 records found in SNS message.");
      }
    } catch (error) {
      console.error("Error processing record:", error);
    }
  }
};

function sendEmailParams({ name, email, message }: ContactDetails) {
  const parameters: SendEmailCommandInput = {
    Destination: {
      ToAddresses: [SES_EMAIL_TO],
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent({ name, email, message }),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `New image Upload`,
      },
    },
    Source: SES_EMAIL_FROM,
  };
  return parameters;
}

function getHtmlContent({ name, email, message }: ContactDetails) {
  return `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${message}</p>
      </body>
    </html> 
  `;
}

