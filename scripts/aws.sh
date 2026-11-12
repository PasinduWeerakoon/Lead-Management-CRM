#!/usr/bin/env bash
# Brings the whole Leads stack up on AWS, or takes it down, with one command. The stack is defined in
# infra/lib/leads-stack.ts (AWS CDK), which turns it into a CloudFormation stack.
#
#   scripts/aws.sh template   Writes the CloudFormation template to infra/template.yaml (no AWS calls)
#   scripts/aws.sh up         Builds the app and creates or updates every service (asks first)
#   scripts/aws.sh status     Shows the stack's state and its outputs (app URL, table name)
#   scripts/aws.sh down       Deletes every service except the data table (asks first)
#   scripts/aws.sh down --delete-data   Also deletes the data table, which cannot be undone
#
# Needs: AWS CLI credentials (AWS_PROFILE, AWS_REGION), Node.js 22, and `npm --prefix infra install` once.
# Server keys are read from .env.local and passed to the Lambda; they are never printed.
# Optional: BUDGET_EMAIL=you@company.com adds a monthly AWS budget alert (BUDGET_USD, default 3).
set -euo pipefail
cd "$(dirname "$0")/.."

STACK="${LEADS_STACK_NAME:-LeadsApp}"
REGION="${AWS_REGION:-ap-south-1}"
export AWS_REGION="$REGION" CDK_DEFAULT_REGION="$REGION"

# Server settings from .env.local, without echoing them. Values already in the shell win.
load_env() {
  [ -f .env.local ] || return 0
  local keys="OPENAI_API_KEY AI_DAILY_CAP_USD GOOGLE_CLIENT_ID SESSION_SECRET ALLOWED_DOMAIN ALLOWED_EMAILS CORESIGNAL_API_KEY HUNTER_API_KEY ADZUNA_APP_ID ADZUNA_APP_KEY APP_ACCESS_KEY BUDGET_EMAIL BUDGET_USD"
  for k in $keys; do
    if [ -z "${!k:-}" ]; then
      local v
      v="$(grep -E "^${k}=" .env.local | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')" || true
      [ -n "$v" ] && export "$k=$v"
    fi
  done
  # The AWS stack keeps data in DynamoDB; a local MongoDB setting must not reach it.
  unset MONGODB_URI
}

confirm() {
  read -r -p "$1 Type '$2' to continue: " answer
  [ "$answer" = "$2" ] || { echo "Stopped. Nothing was changed."; exit 1; }
}

check_aws() {
  command -v aws >/dev/null || { echo "Install the AWS CLI first."; exit 1; }
  aws sts get-caller-identity --query Account --output text >/dev/null ||
    { echo "AWS credentials don't work. Run: aws configure --profile <name>, then AWS_PROFILE=<name> $0 $1"; exit 1; }
  export CDK_DEFAULT_ACCOUNT
  CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
}

build() {
  npm run build
  npm run build:lambda
}

case "${1:-}" in
  template)
    # No .env.local here: the written file must hold placeholders only, never real keys.
    build
    # Placeholders keep real keys out of the written file.
    (cd infra && OPENAI_API_KEY=placeholder CORESIGNAL_API_KEY=placeholder SESSION_SECRET=placeholder \
      npx cdk synth "$STACK" --quiet >/dev/null)
    cp "infra/cdk.out/${STACK}.template.json" infra/template.json
    echo "Wrote infra/template.json (keys replaced by placeholders)."
    ;;
  up)
    load_env
    check_aws up
    echo "Account $CDK_DEFAULT_ACCOUNT, region $REGION, stack $STACK."
    confirm "This creates or updates the Leads services on AWS (S3, CloudFront, Lambda, DynamoDB)." up
    build
    # After a 'down' the data table is kept; reuse it rather than starting with an empty one.
    TABLE_NAME="$(echo "$STACK" | tr '[:upper:]' '[:lower:]')-data"
    if ! aws cloudformation describe-stacks --stack-name "$STACK" >/dev/null 2>&1 &&
      aws dynamodb describe-table --table-name "$TABLE_NAME" >/dev/null 2>&1; then
      echo "Reusing the kept data table $TABLE_NAME."
      export LEADS_EXISTING_DATA_TABLE="$TABLE_NAME"
    fi
    # Once per account and region; does nothing if already done.
    (cd infra && npx cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$REGION")
    (cd infra && npx cdk deploy "$STACK" --require-approval broadening)
    ;;
  status)
    check_aws status
    aws cloudformation describe-stacks --stack-name "$STACK" \
      --query 'Stacks[0].{State:StackStatus,Outputs:Outputs[].[OutputKey,OutputValue]}' --output table
    ;;
  down)
    load_env
    check_aws down
    TABLE="$(aws cloudformation describe-stacks --stack-name "$STACK" \
      --query "Stacks[0].Outputs[?OutputKey=='DataTable'].OutputValue" --output text 2>/dev/null || true)"
    if [ "${2:-}" = "--delete-data" ]; then
      confirm "This deletes every Leads service AND the data table $TABLE. Data cannot be recovered." delete-data
    else
      confirm "This deletes the Leads services. The data table ($TABLE) is kept." down
    fi
    (cd infra && npx cdk destroy "$STACK" --force)
    if [ "${2:-}" = "--delete-data" ] && [ -n "$TABLE" ] && [ "$TABLE" != "None" ]; then
      aws dynamodb delete-table --table-name "$TABLE" >/dev/null
      echo "Deleted data table $TABLE."
    elif [ -n "$TABLE" ] && [ "$TABLE" != "None" ]; then
      echo "Kept data table $TABLE. Run '$0 down --delete-data' before the next 'up' only if you want it gone."
    fi
    ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
