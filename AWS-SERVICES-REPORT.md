# Leads on AWS: services report

Generated 2026-11-12 15:42 UTC from the live stack. Re-create it with `npm run aws:report`.

| | |
|---|---|
| Account | 544011261075 |
| Region | ap-south-1 |
| Stack | LeadsApp (CREATE_COMPLETE) |
| App URL | https://d12pr5zx6tr3p5.cloudfront.net |
| Data table | leadsapp-data |
| Stack console | https://ap-south-1.console.aws.amazon.com/cloudformation/home?region=ap-south-1#/stacks |

## Services (27)

| Service | AWS name | What it does | Cost | How to delete one by one |
|---|---|---|---|---|
| DynamoDB::Table | `LeadsApp-AiSpendD14310E3-1PPW9WSPT7G60` | Shared data or AI spend (on-demand) | Free tier (25 GB), then cents | DynamoDB console: Delete table |
| Lambda::Function | `LeadsApp-ApiF70053CD-NtBvGki4a8cH` | Runs the /api server code (or a deploy helper) | Free tier (1M requests a month) | Lambda console: Delete |
| Lambda::Url | `arn:aws:lambda:ap-south-1:544011261075:function:LeadsApp-ApiF70053CD-NtBvGki4a8cH` | The API address CloudFront calls | Free | Deleted with the function |
| Logs::LogGroup | `LeadsApp-ApiLogs3D05D88B-sXAH8Fzg2Ekv` | API logs, kept 14 days | Cents | CloudWatch console: Log groups, Delete |
| IAM::Role | `LeadsApp-ApiServiceRole1BD550DA-OQud5JfVBEsT` | Permissions for a Lambda | Free | IAM console: Roles, Delete |
| IAM::Policy | `Leads-ApiSe-tmWur6pJzmzW` | Permissions attached to a role | Free | Deleted with the role |
| Lambda::Permission | `LeadsApp-ApiinvokefunctionF0B78F9A-Zkeu5CiPLF7S` | Lets the URL call the function | Free | Deleted with the function |
| Lambda::Permission | `LeadsApp-Apiinvokefunctionurl01061C10-PEbE1quHmSxH` | Lets the URL call the function | Free | Deleted with the function |
| CDK::Metadata | `ddc29a30-deae-11f1-858f-02ffc56812d3` | CDK version info | Free | Deleted with the stack |
| CloudFront::Distribution | `E12VRUPJ9JRIQA` | Serves the web app and /api over HTTPS | Free tier (1 TB, 10M requests a month) | CloudFront console: Disable, wait, then Delete |
| CloudFront::OriginAccessControl | `E11MDI8HN1AHK6` | Lets only CloudFront read the bucket | Free | Deleted with the distribution |
| Lambda::Function | `LeadsApp-CustomCDKBucketDeployment8693BB64968944B6-icVtkRMfoIAT` | Runs the /api server code (or a deploy helper) | Free tier (1M requests a month) | Lambda console: Delete |
| IAM::Role | `LeadsApp-CustomCDKBucketDeployment8693BB64968944B69-qOTRvn035a7O` | Permissions for a Lambda | Free | IAM console: Roles, Delete |
| IAM::Policy | `Leads-Custo-fuxSmtJnYiFa` | Permissions attached to a role | Free | Deleted with the role |
| Lambda::Function | `LeadsApp-CustomS3AutoDeleteObjectsCustomResourcePr-k0AE3toGdfAA` | Runs the /api server code (or a deploy helper) | Free tier (1M requests a month) | Lambda console: Delete |
| IAM::Role | `LeadsApp-CustomS3AutoDeleteObjectsCustomResourcePro-saNwv6SbYhWC` | Permissions for a Lambda | Free | IAM console: Roles, Delete |
| DynamoDB::Table | `leadsapp-data` | Shared data or AI spend (on-demand) | Free tier (25 GB), then cents | Kept on `down`. Use `down --delete-data` or DynamoDB console: Delete table |
| Lambda::LayerVersion | `arn:aws:lambda:ap-south-1:544011261075:layer:DeployAssetsAwsCliLayer986E51B7:1` | AWS CLI layer used while uploading files | Free | Lambda console: Layers, Delete |
| CDKBucketDeployment | `aws.cdk.s3deployment.28bb271f-fc21-4461-9031-5886bc7c4b27` | Uploads the web app on deploy | Free | Deleted with the stack |
| Lambda::LayerVersion | `arn:aws:lambda:ap-south-1:544011261075:layer:DeployIndexAwsCliLayer686F77B7:1` | AWS CLI layer used while uploading files | Free | Lambda console: Layers, Delete |
| CDKBucketDeployment | `aws.cdk.s3deployment.dadaf2a5-209a-4de4-b1a7-f18f30c01fa3` | Uploads the web app on deploy | Free | Deleted with the stack |
| Budgets::Budget | `LeadsApp-monthly` | Emails when the monthly bill nears the budget | Free (first two budgets) | Billing console: Budgets, Delete |
| CloudFront::ResponseHeadersPolicy | `146d7541-7c2e-4bba-ac34-9f9143fe4651` | Security headers | Free | Deleted with the distribution |
| S3AutoDeleteObjects | `0bfb7cc2-3b63-41e8-bb75-19a30fce6cb6` | Empties the bucket when the stack is deleted | Free | Deleted with the stack |
| S3::Bucket | `leadsapp-sitee53d7754-axylvktdymh1` | Holds the built web app (or deploy helper files) | Under $0.01 a month | S3 console: Empty, then Delete |
| S3::BucketPolicy | `leadsapp-sitee53d7754-axylvktdymh1` | Bucket access rules | Free | Deleted with the bucket |
| CloudFront::Function | `arn:aws:cloudfront::544011261075:function/ap-south-1LeadsAppSpaRoutingE6E4C760` | Sends app paths to index.html | Fractions of a cent | Deleted with the distribution |

Expected total while used by a small team: about $1 to $3 a month. There is no VPC, NAT gateway, load balancer or database server, so an idle month costs close to $0.

## Delete everything

All services in one step (the data table is kept so no data is lost):

```bash
AWS_PROFILE=default AWS_REGION=ap-south-1 npm run aws:down
```

Everything including the data (cannot be undone):

```bash
AWS_PROFILE=default AWS_REGION=ap-south-1 scripts/aws.sh down --delete-data
```

Left in the account on purpose:

- **CDKToolkit** stack: CDK's shared deploy bucket for this account and region, also used by other CDK projects here. Remove only if no CDK project in ap-south-1 needs it: empty its `cdk-*-assets-*` bucket, then delete the CDKToolkit stack in CloudFormation.
- **Data table** `leadsapp-data` after a plain `down`, until deleted with `--delete-data`.

After deleting, check nothing is left: CloudFormation shows no LeadsApp stack, and `npm run aws:status` reports that the stack does not exist.
