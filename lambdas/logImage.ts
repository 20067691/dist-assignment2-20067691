/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
import {
  GetObjectCommand,
  GetObjectCommandInput,
  S3Client,

} from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";


const s3 = new S3Client();
const dynamodb = new DynamoDBClient({});

// Environment variables
const TABLE_NAME = process.env.IMAGE_TABLE_NAME!; // DynamoDB table name

// Helper to validate file type
function isValidImageType(key: string): boolean {
  const validExtensions = [".jpeg", ".jpg", ".png"];
  return validExtensions.some((ext) => key.toLowerCase().endsWith(ext));
}

export const handler: SQSHandler = async (event) => {
  console.log("Event ", JSON.stringify(event));

  for (const record of event.Records) {
    try {
      // Parse the SQS message
      const recordBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(recordBody.Message);

      if (snsMessage.Records) {
        console.log("Record body ", JSON.stringify(snsMessage));

        for (const messageRecord of snsMessage.Records) {
          const s3e = messageRecord.s3;
          const srcBucket = s3e.bucket.name;
          // Decode the object key
          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

          console.log(`Processing file: s3://${srcBucket}/${srcKey}`);

          // Validate file type
          if (!isValidImageType(srcKey)) {
            throw new Error(`Invalid file type for object: ${srcKey}`);
          }

          // Fetch image from S3 (if needed)
          const params = {
            Bucket: srcBucket,
            Key: srcKey,
          };
          const objectData = await s3.send(new GetObjectCommand(params));

          console.log("Image downloaded successfully.");

          // Log valid image metadata to DynamoDB
          const dynamoParams = {
            TableName: TABLE_NAME,
            Item: {
              fileName: { S: srcKey }, // Primary key
              uploadTime: { S: new Date().toISOString() },
              bucketName: { S: srcBucket },
              status: { S: "valid" },
            },
          };

          await dynamodb.send(new PutItemCommand(dynamoParams));
          console.log(`Image metadata logged to DynamoDB for: ${srcKey}`);
        }
      }
    } catch (error) {
      console.error("Error processing file:", error);
      // Errors will result in the message being reprocessed or sent to the DLQ

      throw error;
      
    }
  }
};