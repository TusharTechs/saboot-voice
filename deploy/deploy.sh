#!/usr/bin/env bash
# Deploy the demo to AWS:
#   S3 (private) + CloudFront (HTTPS, needed for the microphone) for the web app and clips,
#   Lambda function URL for POST /api/session, routed through the same CloudFront domain.
# Idempotent: re-running updates the code and files. State is kept in deploy/.state.json.
# Requires: aws CLI with credentials, node, npm. Reads OPENAI_API_KEY from .env.
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${AWS_REGION:-$(aws configure get region || echo us-west-2)}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
NAME="saboot-voice"
BUCKET="${NAME}-${ACCOUNT}-${REGION}"
FN="${NAME}-api"
ROLE="${NAME}-lambda-role"
STATE=deploy/.state.json
set -a; [ -f .env ] && . ./.env; set +a
: "${OPENAI_API_KEY:?OPENAI_API_KEY missing in .env}"

echo "== build"
npm run build --silent
mkdir -p dist/lambda
npx esbuild src/server/lambda.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/lambda/index.mjs --log-level=warning
(cd dist/lambda && rm -f fn.zip && zip -q fn.zip index.mjs)
mkdir -p dist/web/clips
cp eval/clips/*.wav dist/web/clips/ 2>/dev/null || true
cp eval/results/summary.json dist/web/summary.json 2>/dev/null || true

echo "== s3 bucket $BUCKET"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then aws s3api create-bucket --bucket "$BUCKET" >/dev/null
  else aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null; fi
  aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi
aws s3 sync dist/web "s3://$BUCKET" --delete --only-show-errors

echo "== lambda $FN"
if ! aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10
fi
ROLE_ARN="$(aws iam get-role --role-name "$ROLE" --query Role.Arn --output text)"
ENVJSON="{\"Variables\":{\"OPENAI_API_KEY\":\"${OPENAI_API_KEY}\"}}"
if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FN" --zip-file fileb://dist/lambda/fn.zip --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FN" --environment "$ENVJSON" --region "$REGION" >/dev/null
else
  aws lambda create-function --function-name "$FN" --runtime nodejs22.x --handler index.handler --role "$ROLE_ARN" \
    --zip-file fileb://dist/lambda/fn.zip --timeout 15 --memory-size 256 --environment "$ENVJSON" --region "$REGION" >/dev/null
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi
if ! aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FN" --auth-type NONE --region "$REGION" >/dev/null
  aws lambda add-permission --function-name "$FN" --statement-id url-public --action lambda:InvokeFunctionUrl \
    --principal "*" --function-url-auth-type NONE --region "$REGION" >/dev/null
fi
FN_URL="$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" --query FunctionUrl --output text)"
FN_HOST="$(echo "$FN_URL" | sed -E 's#https://([^/]+)/?#\1#')"

echo "== cloudfront"
DIST_ID="$(node -e "try{console.log(require('./$STATE').distributionId||'')}catch{console.log('')}")"
if [ -z "$DIST_ID" ]; then
  OAC_ID="$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=${BUCKET}-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" --query OriginAccessControl.Id --output text)"
  CFG="$(node deploy/cloudfront-config.mjs "$BUCKET" "$REGION" "$OAC_ID" "$FN_HOST")"
  DIST_ID="$(aws cloudfront create-distribution --distribution-config "$CFG" --query Distribution.Id --output text)"
  echo "{\"distributionId\":\"$DIST_ID\"}" > "$STATE"
  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",\"Resource\":\"arn:aws:s3:::${BUCKET}/*\",\"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::${ACCOUNT}:distribution/${DIST_ID}\"}}}]}"
else
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" >/dev/null
fi
DOMAIN="$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)"
echo "== done: https://$DOMAIN  (a new distribution takes a few minutes to go live)"
