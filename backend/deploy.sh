#!/bin/bash
# Script to deploy to the EXACT SAME deployment ID to avoid breaking the frontend .env URL
DEPLOYMENT_ID="AKfycby2HVoWDSKdgcr2O0ZJaAwVSj6LEzeXLswyLQV7KPfHuYTdCopAwN0PflrC3u_df9DIAA"
MESSAGE="${1:-Update}"
cd backend
npx @google/clasp push -f
npx @google/clasp deploy -i "$DEPLOYMENT_ID" -d "$MESSAGE"
