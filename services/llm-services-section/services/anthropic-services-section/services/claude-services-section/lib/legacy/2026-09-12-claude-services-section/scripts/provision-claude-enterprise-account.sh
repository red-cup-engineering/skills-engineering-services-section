#!/usr/bin/env bash
# Provision the eip155:5615611 EnterpriseAccount for urn:ame:bare-cedar-fog-claude,
# following the exact lane already walked by inference-work-lot-service (receipt
# 2026-07-30), x402-exact-purchase-service, and settlement-publication:
#   per-node HSM policy-signer key in keyRings/zero-custody-semiotic
#   -> Cloud Run job from the shared enterprise-account-provisioner image
#   -> ERC-4337 account via factory 0x402616b746c56deb665bd163f32ec4b8e7dc0916
#   -> binding written to this settlement's content/evm/accounts/eip155-5615611.json.
#
# Stage 1 (key creation) mutates Cloud KMS and is Leader-gated: this script only
# verifies the key exists and prints the exact creation command if it does not.
set -euo pipefail

PROJECT=five-six-one-group-dev
REGION=us-central1
KEYRING=zero-custody-semiotic
KEY=bare-cedar-fog-claude-policy-signer
KEY_VERSION="projects/${PROJECT}/locations/${REGION}/keyRings/${KEYRING}/cryptoKeys/${KEY}/cryptoKeyVersions/1"
JOB=provision-bare-cedar-fog-claude-account
IMAGE="us-central1-docker.pkg.dev/${PROJECT}/union-actuators/enterprise-account-provisioner@sha256:52491326c1bb595e0c224a9340b81d32ba9592654161d22dd8a685103ce7bd0b"
SERVICE_ACCOUNT="a5615611-contract-deployer@${PROJECT}.iam.gserviceaccount.com"
URN=urn:ame:bare-cedar-fog-claude
NODE_ID=bare-cedar-fog-claude-services-section
RPC_URL=http://10.128.0.2:8563
DEPLOYER_ADDRESS=0xacd5243c5734f68e866047231f1017a8a9832c3e
DEPLOYER_KMS_KEY_VERSION="projects/${PROJECT}/locations/${REGION}/keyRings/${KEYRING}/cryptoKeys/a5615611-contract-deployer/cryptoKeyVersions/1"
MINIMUM_ACCOUNT_FUNDING_WEI=10000000000000000

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROVISIONING_SERVICE="${HERE}/../../../../../../red-cup-engineering/services/software-services-section/services/blockchain-services-section/services/ethereum-services-section/services/account-abstraction-services-section/services/enterprise-account-provisioning-service"

if ! gcloud kms keys describe "$KEY" --keyring "$KEYRING" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  echo "OBSTRUCTION: policy-signer key absent. Leader-gated creation command:" >&2
  echo "  gcloud kms keys create ${KEY} --keyring ${KEYRING} --location ${REGION} --project ${PROJECT} --purpose asymmetric-signing --default-algorithm ec-sign-secp256k1-sha256 --protection-level hsm" >&2
  exit 2
fi

PEM_FILE="$(mktemp)"
trap 'rm -f "$PEM_FILE"' EXIT
gcloud kms keys versions get-public-key 1 --key "$KEY" --keyring "$KEYRING" --location "$REGION" --project "$PROJECT" --output-file "$PEM_FILE" >/dev/null

POLICY_SIGNER="$(cd "$PROVISIONING_SERVICE" && node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { computeAddress } from 'ethers';
const pem = readFileSync(process.argv[1], 'utf8');
const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
const point = der.subarray(der.length - 65);
if (point[0] !== 0x04) throw new Error('SPKI does not end in an uncompressed secp256k1 point');
console.log(computeAddress('0x' + point.toString('hex')).toLowerCase());
" "$PEM_FILE")"
echo "policy signer: $POLICY_SIGNER"

if ! gcloud run jobs describe "$JOB" --region "$REGION" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud run jobs create "$JOB" \
    --image "$IMAGE" \
    --region "$REGION" --project "$PROJECT" \
    --service-account "$SERVICE_ACCOUNT" \
    --set-env-vars "RPC_URL=${RPC_URL},URN=${URN},POLICY_SIGNER=${POLICY_SIGNER},POLICY_KEY_VERSION=${KEY_VERSION},DEPLOYER_ADDRESS=${DEPLOYER_ADDRESS},DEPLOYER_KMS_KEY_VERSION=${DEPLOYER_KMS_KEY_VERSION},MINIMUM_ACCOUNT_FUNDING_WEI=${MINIMUM_ACCOUNT_FUNDING_WEI},NODE_ID=${NODE_ID}"
fi

gcloud run jobs execute "$JOB" --region "$REGION" --project "$PROJECT" --wait

echo "Provisioning executed. Retrieve the receipt from the execution logs:" >&2
echo "  gcloud logging read 'resource.type=cloud_run_job resource.labels.job_name=${JOB}' --project ${PROJECT} --limit 50 --format 'value(textPayload)'" >&2
echo "then write the binding to ${HERE}/content/evm/accounts/eip155-5615611.json" >&2
