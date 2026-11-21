// Prints a CloudFront DistributionConfig: S3 (via OAC) for the app, Lambda URL for /api/*.
const [bucket, region, oacId, fnHost] = process.argv.slice(2);
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ALL_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

const cfg = {
  CallerReference: `saboot-voice-${Date.now()}`,
  Comment: "Saboot Voice demo",
  Enabled: true,
  DefaultRootObject: "index.html",
  PriceClass: "PriceClass_200",
  Origins: {
    Quantity: 2,
    Items: [
      {
        Id: "web",
        DomainName: `${bucket}.s3.${region}.amazonaws.com`,
        OriginAccessControlId: oacId,
        S3OriginConfig: { OriginAccessIdentity: "" },
      },
      {
        Id: "api",
        DomainName: fnHost,
        CustomOriginConfig: { HTTPPort: 80, HTTPSPort: 443, OriginProtocolPolicy: "https-only", OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] } },
      },
    ],
  },
  DefaultCacheBehavior: {
    TargetOriginId: "web",
    ViewerProtocolPolicy: "redirect-to-https",
    CachePolicyId: CACHING_OPTIMIZED,
    Compress: true,
    AllowedMethods: { Quantity: 2, Items: ["GET", "HEAD"], CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] } },
  },
  CacheBehaviors: {
    Quantity: 1,
    Items: [
      {
        PathPattern: "/api/*",
        TargetOriginId: "api",
        ViewerProtocolPolicy: "https-only",
        CachePolicyId: CACHING_DISABLED,
        OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST,
        AllowedMethods: {
          Quantity: 7,
          Items: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
          CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
        },
      },
    ],
  },
};
console.log(JSON.stringify(cfg));
