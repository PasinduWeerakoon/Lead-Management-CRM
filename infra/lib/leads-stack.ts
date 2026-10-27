import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as cdk from 'aws-cdk-lib'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import type { Construct } from 'constructs'

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))

export interface LeadsStackProps extends cdk.StackProps {
  /** Workspace access code the app asks for (there's no login). */
  accessKey: string
  /** Optional MongoDB Atlas connection string for the shared database. */
  mongodbUri?: string
  /** Optional company OpenAI key, used only on the server (/api/ai). */
  openaiApiKey?: string
  /** Daily limit for the company key, in USD. */
  aiDailyCapUsd?: number
}

/**
 * Leads on AWS, built for the lowest running cost:
 *  - the web app is static files in a private S3 bucket, served by CloudFront
 *  - every /api/* route is ONE Arm64 Lambda behind a Function URL (no API Gateway), reachable only
 *    through CloudFront (a secret header the Lambda checks)
 *  - no VPC, no NAT gateway, no always-on servers; logs kept 14 days
 */
export class LeadsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LeadsStackProps) {
    super(scope, id, props)

    // Stable across deploys (derived, not random), so CloudFront and Lambda always agree.
    const originSecret = createHash('sha256').update(`${props.accessKey}:origin:${id}`).digest('hex')

    // --- API: one Lambda for all server functions ---------------------------------------------
    const logGroup = new logs.LogGroup(this, 'ApiLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    // Today's spend on the company AI key, shared by every Lambda instance. On-demand: costs cents at most.
    const spend = props.openaiApiKey
      ? new dynamodb.Table(this, 'AiSpend', {
          partitionKey: { name: 'day', type: dynamodb.AttributeType.STRING },
          billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
          timeToLiveAttribute: 'expiresAt',
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        })
      : undefined

    const api = new lambda.Function(this, 'Api', {
      description: 'Leads /api/* — company research, Apollo forwarding, optional shared database',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(root('dist-lambda')),
      memorySize: 512,
      // Company research reads several pages; the code keeps itself under 40s, CloudFront waits 60s.
      timeout: cdk.Duration.seconds(60),
      logGroup,
      environment: {
        NODE_ENV: 'production',
        APP_ACCESS_KEY: props.accessKey,
        ORIGIN_VERIFY_SECRET: originSecret,
        ...(props.mongodbUri ? { MONGODB_URI: props.mongodbUri, MONGODB_DB: 'leads' } : {}),
        ...(props.openaiApiKey && spend
          ? {
              OPENAI_API_KEY: props.openaiApiKey,
              AI_DAILY_CAP_USD: String(props.aiDailyCapUsd ?? 10),
              SPEND_TABLE: spend.tableName,
            }
          : {}),
      },
    })
    spend?.grant(api, 'dynamodb:GetItem', 'dynamodb:UpdateItem')
    const apiUrl = api.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE })

    // --- Web app: private bucket ---------------------------------------------------------------
    const site = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    // --- Security headers (the same ones vercel.json sets) -------------------------------------
    const vercel = JSON.parse(readFileSync(root('vercel.json'), 'utf8')) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>
    }
    const h = Object.fromEntries(vercel.headers[0].headers.map((x) => [x.key.toLowerCase(), x.value]))
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: h['content-security-policy'], override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Permissions-Policy', value: h['permissions-policy'], override: true }],
      },
    })

    // Single-page app: any path that isn't a file (/, /presets, /briefs…) serves index.html.
    const spaRouting = new cloudfront.Function(this, 'SpaRouting', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) { r.uri = '/index.html'; } return r; }",
      ),
    })

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Leads web app and API',
      defaultRootObject: 'index.html',
      // North America, Europe, Asia (incl. India) — close to Sri Lanka without the most expensive edges.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [{ function: spaRouting, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.FunctionUrlOrigin(apiUrl, {
            customHeaders: { 'x-origin-verify': originSecret },
            readTimeout: cdk.Duration.seconds(60),
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: securityHeaders,
        },
      },
    })

    // --- Upload the built app: hashed assets cached for a year, index.html always fresh ---------
    const assets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(root('dist'), { exclude: ['index.html'] })],
      destinationBucket: site,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
      memoryLimit: 512,
    })
    const page = new s3deploy.BucketDeployment(this, 'DeployIndex', {
      sources: [s3deploy.Source.asset(root('dist'), { exclude: ['*', '!index.html'] })],
      destinationBucket: site,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
      prune: false,
      distribution,
      distributionPaths: ['/index.html', '/'],
      memoryLimit: 512,
    })
    page.node.addDependency(assets)

    new cdk.CfnOutput(this, 'AppUrl', { value: `https://${distribution.distributionDomainName}` })
    new cdk.CfnOutput(this, 'BucketName', { value: site.bucketName })
    new cdk.CfnOutput(this, 'ApiFunction', { value: api.functionName })
  }
}
