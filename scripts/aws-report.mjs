// Writes AWS-SERVICES-REPORT.md: every service in the Leads stack, its AWS name, what it costs, and how
// to delete it (all at once with `scripts/aws.sh down`, or one by one). Reads the live stack with the
// AWS CLI; changes nothing.  Usage: node scripts/aws-report.mjs <stack> <region>
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [stack = 'LeadsApp', region = 'ap-south-1'] = process.argv.slice(2)
const aws = (...args) =>
  JSON.parse(execFileSync('aws', [...args, '--region', region, '--output', 'json'], { encoding: 'utf8' }))

const s = aws('cloudformation', 'describe-stacks', '--stack-name', stack).Stacks[0]
const resources = aws('cloudformation', 'describe-stack-resources', '--stack-name', stack).StackResources
const account = s.StackId.split(':')[4]
const out = Object.fromEntries((s.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]))

/** What each kind of resource is for, what it costs here, and how to remove it by hand. */
const KINDS = {
  'AWS::CloudFront::Distribution': [
    'Serves the web app and /api over HTTPS',
    'Free tier (1 TB, 10M requests a month)',
    'CloudFront console: Disable, wait, then Delete',
  ],
  'AWS::CloudFront::Function': [
    'Sends app paths to index.html',
    'Fractions of a cent',
    'Deleted with the distribution',
  ],
  'AWS::CloudFront::OriginAccessControl': [
    'Lets only CloudFront read the bucket',
    'Free',
    'Deleted with the distribution',
  ],
  'AWS::CloudFront::ResponseHeadersPolicy': ['Security headers', 'Free', 'Deleted with the distribution'],
  'AWS::S3::Bucket': [
    'Holds the built web app (or deploy helper files)',
    'Under $0.01 a month',
    'S3 console: Empty, then Delete',
  ],
  'AWS::S3::BucketPolicy': ['Bucket access rules', 'Free', 'Deleted with the bucket'],
  'AWS::Lambda::Function': [
    'Runs the /api server code (or a deploy helper)',
    'Free tier (1M requests a month)',
    'Lambda console: Delete',
  ],
  'AWS::Lambda::Url': ['The API address CloudFront calls', 'Free', 'Deleted with the function'],
  'AWS::Lambda::Permission': ['Lets the URL call the function', 'Free', 'Deleted with the function'],
  'AWS::Lambda::LayerVersion': ['AWS CLI layer used while uploading files', 'Free', 'Lambda console: Layers, Delete'],
  'AWS::DynamoDB::Table': [
    'Shared data or AI spend (on-demand)',
    'Free tier (25 GB), then cents',
    'DynamoDB console: Delete table',
  ],
  'AWS::Logs::LogGroup': ['API logs, kept 14 days', 'Cents', 'CloudWatch console: Log groups, Delete'],
  'AWS::IAM::Role': ['Permissions for a Lambda', 'Free', 'IAM console: Roles, Delete'],
  'AWS::IAM::Policy': ['Permissions attached to a role', 'Free', 'Deleted with the role'],
  'AWS::Budgets::Budget': [
    'Emails when the monthly bill nears the budget',
    'Free (first two budgets)',
    'Billing console: Budgets, Delete',
  ],
  'Custom::CDKBucketDeployment': ['Uploads the web app on deploy', 'Free', 'Deleted with the stack'],
  'Custom::S3AutoDeleteObjects': ['Empties the bucket when the stack is deleted', 'Free', 'Deleted with the stack'],
  'AWS::CDK::Metadata': ['CDK version info', 'Free', 'Deleted with the stack'],
}

const rows = resources
  .map((r) => {
    const [use, cost, remove] = KINDS[r.ResourceType] ?? ['', '', 'Deleted with the stack']
    const kept = r.LogicalResourceId.startsWith('Data') && r.ResourceType === 'AWS::DynamoDB::Table'
    return `| ${r.ResourceType.replace(/^AWS::|^Custom::/, '')} | \`${r.PhysicalResourceId}\` | ${use} | ${cost} | ${kept ? 'Kept on `down`. Use `down --delete-data` or ' + remove : remove} |`
  })
  .join('\n')

const md = `# Leads on AWS: services report

Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from the live stack. Re-create it with \`npm run aws:report\`.

| | |
|---|---|
| Account | ${account} |
| Region | ${region} |
| Stack | ${stack} (${s.StackStatus}) |
| App URL | ${out.AppUrl ?? ''} |
| Data table | ${out.DataTable ?? ''} |
| Stack console | https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks |

## Services (${resources.length})

| Service | AWS name | What it does | Cost | How to delete one by one |
|---|---|---|---|---|
${rows}

Expected total while used by a small team: about $1 to $3 a month. There is no VPC, NAT gateway, load balancer or database server, so an idle month costs close to $0.

## Delete everything

All services in one step (the data table is kept so no data is lost):

\`\`\`bash
AWS_PROFILE=default AWS_REGION=${region} npm run aws:down
\`\`\`

Everything including the data (cannot be undone):

\`\`\`bash
AWS_PROFILE=default AWS_REGION=${region} scripts/aws.sh down --delete-data
\`\`\`

Left in the account on purpose:

- **CDKToolkit** stack: CDK's shared deploy bucket for this account and region, also used by other CDK projects here. Remove only if no CDK project in ${region} needs it: empty its \`cdk-*-assets-*\` bucket, then delete the CDKToolkit stack in CloudFormation.
- **Data table** \`${out.DataTable ?? ''}\` after a plain \`down\`, until deleted with \`--delete-data\`.

After deleting, check nothing is left: CloudFormation shows no ${stack} stack, and \`npm run aws:status\` reports that the stack does not exist.
`
writeFileSync('AWS-SERVICES-REPORT.md', md)
console.log(`Wrote AWS-SERVICES-REPORT.md (${resources.length} services).`)
