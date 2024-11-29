import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as eventsources from "aws-cdk-lib/aws-lambda-event-sources";

import { Construct } from "constructs";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "env";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Creating an S3 bucket for image uploads 
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // SNS Topic definition (FOR IMAGE UPLOAD NOTIFICATIONS)
    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    // Create a Dead Letter Queue (DLQ)
    const dlq = new sqs.Queue(this, "DLQ", {
      queueName: "image-processing-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    // SQS queue for image processing 
    const imageProcessQueue = new sqs.Queue(this, "ImageProcessingQueue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 5,
      },
    });



    // Create a DynamoDB table to log valid images
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });



    // Log Image Lambda function 
    const logImageFn = new lambdanode.NodejsFunction(
      this,
      "LogImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/logImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          IMAGE_TABLE_NAME: imageTable.tableName
        },
      }
    );

    // Grant permissions to Log Image Lambda
    imagesBucket.grantRead(logImageFn);
    imageTable.grantWriteData(logImageFn);


    // Confirmation Mailer Lambda function 
    const confirmationMailerFn = new lambdanode.NodejsFunction(this, "ConfirmationMailerFn", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
      environment: {
        SES_EMAIL_FROM: process.env.SES_EMAIL_FROM!,
        SES_EMAIL_TO: process.env.SES_EMAIL_TO!,
        SES_REGION: process.env.SES_REGION!,
      }
    });

    //SES permissions to the Confirmation Mailer Lambda
    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Rejection Mailer Lambda
    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "RejectionMailerFn", {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(10),
      environment: {
        SES_EMAIL_FROM: process.env.SES_EMAIL_FROM!,
        SES_EMAIL_TO: process.env.SES_EMAIL_TO!,
        SES_REGION: process.env.SES_REGION!,
      },
    });

    // Grant DLQ permissions to the Rejection Mailer Lambda
    dlq.grantConsumeMessages(rejectionMailerFn);

   // SES permissions to the Rejection Mailer Lambda
    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail", 
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail"
        ],
        resources: ["*"], 
      })
    );

    // Sunscribe the SQS queue to the SNS topic 
    newImageTopic.addSubscription(new subs.SqsSubscription(imageProcessQueue));

    // Subscribe the Confirmation Mailer Lambda to the SNS topic
    newImageTopic.addSubscription(
      new subs.LambdaSubscription(confirmationMailerFn)
    );


    // Add SQS event source to Log Image Lambda
    logImageFn.addEventSource(
      new eventsources.SqsEventSource(imageProcessQueue)
    );

    // Add event notifications to S3 bucket for SNS topic
    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );

    // Add the SQS event source to the Lambda function
    rejectionMailerFn.addEventSource(
      new eventsources.SqsEventSource(dlq, {
        batchSize: 10, // Process up to 10 messages at once
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // Output

    new cdk.CfnOutput(this, "BucketName", {
      value: imagesBucket.bucketName,
    });
    new cdk.CfnOutput(this, "SNS Topic ARN", {
      value: newImageTopic.topicArn,
    });
    new cdk.CfnOutput(this, "Image Processing Queue URL", {
      value: imageProcessQueue.queueUrl,
    });
    new cdk.CfnOutput(this, "DLQ URL", {
      value: dlq.queueUrl,
    });
    new cdk.CfnOutput(this, "DynamoDB Table Name", {
      value: imageTable.tableName,
    });

  }
}
