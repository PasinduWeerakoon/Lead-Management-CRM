// Creates the shared-data table in DynamoDB Local (or any endpoint in DYNAMODB_ENDPOINT).
// Same shape as the AWS stack: pk + sk, on-demand, with the bySrv index. Safe to run twice.
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'

const table = process.env.DATA_TABLE || 'leads-data'
const endpoint = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'
const client = new DynamoDBClient({
  endpoint,
  region: process.env.AWS_REGION || 'local',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
})
try {
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'pk', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
        { AttributeName: 'srv', AttributeType: 'N' },
      ],
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      LocalSecondaryIndexes: [
        {
          IndexName: 'bySrv',
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'srv', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  )
  console.log(`Created ${table} at ${endpoint}`)
} catch (err) {
  if (err.name === 'ResourceInUseException') console.log(`${table} already exists at ${endpoint}`)
  else throw err
}
